// Sunday weekly email recap. Three callable modes:
//
//   GET  /api/email/weekly                     — sends to YOUR account email (logged-in user)
//   GET  /api/email/weekly?preview=1           — returns the HTML for preview (no send)
//   GET  /api/email/weekly                     — also works as a Vercel cron entry point when
//                                                called with Authorization: Bearer CRON_SECRET
//                                                (iterates every user, sends to each)
//
// No-ops gracefully when RESEND_API_KEY is missing — returns 200 with skipped:true.

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { llmComplete } from "@/lib/llm";
import { parseLenientJson } from "@/lib/agent/jsonRepair";
import { getQuotesProvider } from "@/lib/providers/quotes";
import { getNextEarningsBatch } from "@/lib/providers/earnings-calendar";
import { getUserSettings } from "@/lib/settings";
import { getFrameById, pickFrame, FRAMES } from "@/lib/agent/industryFrames";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { buildWeeklyEmailHtml, buildWeeklyEmailText, type WeeklyEmailData } from "@/lib/email-templates";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const SYSTEM = `You are writing a Sunday-night portfolio recap for a discretionary fund PM.

Output JSON ONLY:
{
  "headline": "1-sentence punchy summary of the week",
  "performance": "1 short paragraph: which names outperformed, which lagged, vs the benchmark if given. Cite specific tickers and % moves.",
  "thesisChanges": "1 short paragraph: any thesis status changes (intact/strengthened/weakened/broken) with the WHY",
  "upcoming": "1 short paragraph: earnings + macro events in the next 7-10 days that matter for the book",
  "callToAction": ["1-3 specific things to do or watch this week — concrete, not generic"]
}

Rules:
- Be PM-voiced: declarative, terse, opinionated. No hedging.
- Skip generic advice. Every bullet must reference this book's actual state.
- Email-friendly length — each paragraph ~2-3 sentences max.`;

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const preview = url.searchParams.get("preview") === "1";

  // Mode 1 — Cron entry point (Authorization: Bearer CRON_SECRET).
  const authHeader = req.headers.get("authorization");
  const cronExpected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (cronExpected && authHeader === cronExpected) {
    return runCronForAllUsers();
  }

  // Mode 2 — Logged-in user.
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  try {
    const data = await buildWeeklyDataForUser(supabase, user.user.id);
    if (preview) {
      const html = buildWeeklyEmailHtml(data);
      return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }

    if (!isEmailConfigured()) {
      return NextResponse.json({ ok: false, skipped: true, reason: "RESEND_API_KEY not set" });
    }
    const email = user.user.email;
    if (!email) {
      return NextResponse.json({ error: "User has no email on file" }, { status: 400 });
    }
    const html = buildWeeklyEmailHtml(data);
    const text = buildWeeklyEmailText(data);
    const res = await sendEmail({
      to: email,
      subject: `The Terminal — week of ${data.weekOfIso}`,
      html,
      text,
    });
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message, month: err.month }, { status: 402 });
    }
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

async function runCronForAllUsers(): Promise<NextResponse> {
  if (!isEmailConfigured()) {
    return NextResponse.json({ ok: false, skipped: true, reason: "RESEND_API_KEY not set" });
  }
  const admin = createAdminSupabase();
  // Distinct user_ids that have at least one ticker (only users with a book get the recap).
  const { data: rows } = await admin.from("tickers").select("user_id");
  const userIds = Array.from(new Set(((rows ?? []) as Array<{ user_id: string }>).map((r) => r.user_id)));

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  for (const userId of userIds) {
    try {
      const { data: u } = await admin.auth.admin.getUserById(userId);
      const email = u?.user?.email;
      if (!email) {
        skipped++;
        continue;
      }
      const data = await buildWeeklyDataForUser(admin, userId);
      const html = buildWeeklyEmailHtml(data);
      const text = buildWeeklyEmailText(data);
      const res = await sendEmail({
        to: email,
        subject: `The Terminal — week of ${data.weekOfIso}`,
        html,
        text,
      });
      if (res.ok) sent++;
      else failed++;
    } catch (err) {
      console.error("weekly email failed for", userId, err);
      failed++;
    }
  }
  return NextResponse.json({ ok: true, sent, failed, skipped, total: userIds.length });
}

async function buildWeeklyDataForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<WeeklyEmailData> {
  const { data: tickerRows } = await supabase
    .from("tickers")
    .select("symbol,name,tier,sector,industry,frame_id,benchmark_symbol")
    .eq("user_id", userId)
    .order("tier")
    .order("symbol");
  const tickers = (tickerRows ?? []) as Array<{
    symbol: string;
    name: string | null;
    tier: number;
    sector: string | null;
    industry: string | null;
    frame_id: string | null;
    benchmark_symbol: string | null;
  }>;
  if (tickers.length === 0) {
    throw new Error("No tickers in book — nothing to recap.");
  }
  const settings = await getUserSettings(supabase, userId);
  void settings; // reserved for future personalization

  // Pick a benchmark — the most common frame across the user's book, falling back to SPY.
  const frameCounts = new Map<string, number>();
  for (const t of tickers) {
    const frame = getFrameById(t.frame_id) ?? pickFrame(t.sector, t.industry);
    frameCounts.set(frame.id, (frameCounts.get(frame.id) ?? 0) + 1);
  }
  let bestFrameId = "generalist";
  let bestCount = 0;
  for (const [id, n] of frameCounts) {
    if (n > bestCount) {
      bestFrameId = id;
      bestCount = n;
    }
  }
  const bestFrame = FRAMES[bestFrameId] ?? FRAMES.generalist;
  const benchmarkSymbol = bestFrame.benchmarkSymbol;
  const benchmarkLabel = bestFrame.benchmarkLabel;

  const symbols = tickers.map((t) => t.symbol);
  const allSyms = Array.from(new Set([...symbols, benchmarkSymbol]));
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

  const benchR = weeklyReturn(benchmarkSymbol);
  const perfTable = tickers.map((t) => ({
    symbol: t.symbol,
    tier: t.tier,
    returnPct: weeklyReturn(t.symbol),
  }));

  // Thesis transitions in last 7d.
  const cutoff = new Date(Date.now() - 7 * 86400_000).toISOString();
  const { data: thesisRows } = await supabase
    .from("thesis_snapshots")
    .select("symbol,status,generated_at")
    .eq("user_id", userId)
    .gte("generated_at", cutoff)
    .order("generated_at", { ascending: true });
  type ThesisRow = { symbol: string; status: string; generated_at: string };
  const theses = (thesisRows ?? []) as ThesisRow[];
  const transitions: Array<{ symbol: string; from: string; to: string; at: string }> = [];
  const lastStatus = new Map<string, string>();
  for (const t of theses) {
    const prev = lastStatus.get(t.symbol);
    if (prev && prev !== t.status) transitions.push({ symbol: t.symbol, from: prev, to: t.status, at: t.generated_at });
    lastStatus.set(t.symbol, t.status);
  }

  // Upcoming earnings (≤10d).
  const upcoming = await getNextEarningsBatch(symbols);
  const upcomingEarnings = upcoming
    .filter((e) => e.earningsDate && e.daysUntil != null && e.daysUntil <= 10 && e.daysUntil >= 0)
    .map((e) => ({ symbol: e.symbol, date: e.earningsDate, daysUntil: e.daysUntil, timing: e.timing }));

  // LLM recap — same shape as /api/journal/weekly-summary but trimmed for email.
  await ensureBudget(supabase, userId);
  const perfLines = perfTable
    .map((p) => (p.returnPct != null ? `${p.symbol}: ${p.returnPct >= 0 ? "+" : ""}${p.returnPct.toFixed(2)}%` : `${p.symbol}: n/a`))
    .join(", ");
  const userPrompt = [
    "BOOK:",
    tickers.map((t) => `T${t.tier} ${t.symbol}${t.name ? ` (${t.name})` : ""}`).join("\n"),
    "",
    `WEEKLY PERFORMANCE (5d): ${perfLines}`,
    benchR != null ? `Benchmark ${benchmarkSymbol}: ${benchR >= 0 ? "+" : ""}${benchR.toFixed(2)}%` : "",
    "",
    "THESIS STATUS TRANSITIONS THIS WEEK:",
    transitions.length
      ? transitions.map((t) => `${t.symbol}: ${t.from} → ${t.to} (${t.at.slice(0, 10)})`).join("\n")
      : "(no status changes)",
    "",
    "UPCOMING (next 10d):",
    upcomingEarnings.length
      ? upcomingEarnings.map((e) => `${e.symbol} on ${e.date}${e.timing ? ` (${e.timing})` : ""}${e.daysUntil != null ? ` — ${e.daysUntil}d` : ""}`).join("\n")
      : "(none)",
    "",
    "Produce the JSON recap now.",
  ]
    .filter((s) => s !== "")
    .join("\n");

  const completion = await llmComplete({
    purpose: "thesis",
    system: SYSTEM,
    user: userPrompt,
    maxTokens: 1200,
    jsonResponse: true,
  });
  await recordUsage(
    { userId, model: completion.model, endpoint: "email.weekly", usage: completion.usage },
    supabase,
  );

  const parsed = parseLenientJson<{
    headline?: string;
    performance?: string;
    thesisChanges?: string;
    upcoming?: string;
    callToAction?: string | string[];
  }>(completion.text);

  const weekOfIso = new Date().toISOString().slice(0, 10);
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000";

  return {
    userLabel: "",
    weekOfIso,
    appUrl,
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
    perfTable,
    benchmarkReturnPct: benchR,
    benchmarkLabel,
    transitions,
    upcomingEarnings,
  };
}
