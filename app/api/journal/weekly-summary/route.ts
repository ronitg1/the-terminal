// "This week in my book" — generates a Claude-grade weekly summary covering
// ticker performance, thesis status changes, and upcoming events. On-demand
// (not stored — cheap to regenerate).

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { llmComplete } from "@/lib/llm";
import { parseLenientJson } from "@/lib/agent/jsonRepair";
import { getQuotesProvider } from "@/lib/providers/quotes";
import { getNextEarningsBatch } from "@/lib/providers/earnings-calendar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM = `You are writing a Sunday-night portfolio recap for a discretionary energy-transition fund PM.

The recap covers: how your tickers performed last week, any thesis status changes the agent flagged, and what's coming up next week (earnings + macro).

Output JSON ONLY:
{
  "headline": "1-sentence punchy summary of the week",
  "performance": "1 paragraph: which names outperformed, which lagged, vs ICLN if data given",
  "thesisChanges": "1 paragraph: any thesis status changes (intact/strengthened/weakened/broken) with the WHY",
  "upcoming": "1 paragraph: earnings + macro events in the next 7-10 days that matter for the book",
  "callToAction": "1-3 specific things to do or watch this week"
}

Rules:
- Be PM-voiced: declarative, terse, opinionated. No hedging language.
- Cite specific tickers and percent moves where applicable.
- Skip generic advice. No "diversification" or "stay disciplined" filler.`;

export async function POST(_req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  try {
    await ensureBudget(supabase, user.user.id);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message, month: err.month }, { status: 402 });
    }
    throw err;
  }

  // Gather data: tickers + this week's perf vs ICLN + recent thesis status changes + upcoming earnings
  const { data: tickerRows } = await supabase
    .from("tickers")
    .select("symbol,name,tier")
    .eq("user_id", user.user.id)
    .order("tier")
    .order("symbol");
  const tickers = (tickerRows ?? []) as Array<{ symbol: string; name: string | null; tier: number }>;
  if (tickers.length === 0) {
    return NextResponse.json({ error: "No tickers in your book." }, { status: 400 });
  }
  const symbols = tickers.map((t) => t.symbol);

  // 1-week history for each ticker + ICLN benchmark
  const allSyms = Array.from(new Set([...symbols, "ICLN"]));
  const histories = await Promise.all(
    allSyms.map(async (s) => ({ sym: s, hist: await getQuotesProvider().history(s, "1mo") })),
  );
  const histBySym = new Map(histories.map((h) => [h.sym, h.hist]));

  function weeklyReturn(sym: string): number | null {
    const h = histBySym.get(sym) ?? [];
    if (h.length < 6) return null;
    const lookback = h.slice(-6);
    const start = lookback[0].close;
    const end = lookback[lookback.length - 1].close;
    if (start <= 0) return null;
    return ((end / start) - 1) * 100;
  }

  const perfLines = symbols
    .map((s) => {
      const r = weeklyReturn(s);
      return r != null ? `${s}: ${r >= 0 ? "+" : ""}${r.toFixed(2)}%` : `${s}: n/a`;
    })
    .join(", ");
  const iclnR = weeklyReturn("ICLN");

  // Recent thesis status changes (within last 7 days)
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: thesisRows } = await supabase
    .from("thesis_snapshots")
    .select("symbol,status,conviction,generated_at")
    .eq("user_id", user.user.id)
    .gte("generated_at", cutoff)
    .order("generated_at", { ascending: true });
  type ThesisRow = { symbol: string; status: string; conviction: number | null; generated_at: string };
  const theses = (thesisRows ?? []) as ThesisRow[];
  // Walk per symbol to find status transitions
  const transitions: Array<{ symbol: string; from: string; to: string; at: string }> = [];
  const lastStatus = new Map<string, string>();
  for (const t of theses) {
    const prev = lastStatus.get(t.symbol);
    if (prev && prev !== t.status) {
      transitions.push({ symbol: t.symbol, from: prev, to: t.status, at: t.generated_at });
    }
    lastStatus.set(t.symbol, t.status);
  }

  // Upcoming earnings in next 10 days
  const upcomingEarn = await getNextEarningsBatch(symbols);
  const upcomingLines = upcomingEarn
    .filter((e) => e.earningsDate && e.daysUntil != null && e.daysUntil <= 10 && e.daysUntil >= 0)
    .map((e) => `${e.symbol} on ${e.earningsDate}${e.timing ? ` (${e.timing})` : ""}${e.daysUntil != null ? ` — ${e.daysUntil}d` : ""}`)
    .join("; ");

  const userPrompt = [
    `BOOK:`,
    tickers.map((t) => `T${t.tier} ${t.symbol}${t.name ? ` (${t.name})` : ""}`).join("\n"),
    "",
    `WEEKLY PERFORMANCE:`,
    perfLines,
    iclnR != null ? `Benchmark ICLN: ${iclnR >= 0 ? "+" : ""}${iclnR.toFixed(2)}%` : "",
    "",
    `THESIS STATUS TRANSITIONS THIS WEEK:`,
    transitions.length > 0
      ? transitions.map((t) => `${t.symbol}: ${t.from} → ${t.to} (${t.at.slice(0, 10)})`).join("\n")
      : "(no status changes)",
    "",
    `UPCOMING (next 10d):`,
    upcomingLines || "(none)",
    "",
    "Produce the JSON recap now.",
  ]
    .filter((s) => s !== "")
    .join("\n");

  const completion = await llmComplete({
    purpose: "thesis",
    system: SYSTEM,
    user: userPrompt,
    maxTokens: 1500,
    jsonResponse: true,
  });

  await recordUsage(
    {
      userId: user.user.id,
      model: completion.model,
      endpoint: "journal.weekly_summary",
      usage: completion.usage,
    },
    supabase,
  );

  const parsed = parseLenientJson<{
    headline?: string;
    performance?: string;
    thesisChanges?: string;
    upcoming?: string;
    callToAction?: string | string[];
  }>(completion.text);

  return NextResponse.json({
    summary: {
      headline: String(parsed.headline ?? "").trim(),
      performance: String(parsed.performance ?? "").trim(),
      thesisChanges: String(parsed.thesisChanges ?? "").trim(),
      upcoming: String(parsed.upcoming ?? "").trim(),
      callToAction: Array.isArray(parsed.callToAction)
        ? parsed.callToAction.map(String).filter(Boolean)
        : typeof parsed.callToAction === "string"
        ? [parsed.callToAction]
        : [],
    },
    metrics: {
      symbols: tickers.map((t) => t.symbol),
      weeklyReturns: symbols.map((s) => ({ symbol: s, returnPct: weeklyReturn(s) })),
      iclnReturnPct: iclnR,
      transitions,
      upcomingEarnings: upcomingEarn
        .filter((e) => e.earningsDate && e.daysUntil != null && e.daysUntil <= 10 && e.daysUntil >= 0)
        .map((e) => ({ symbol: e.symbol, date: e.earningsDate, daysUntil: e.daysUntil, timing: e.timing })),
    },
  });
}
