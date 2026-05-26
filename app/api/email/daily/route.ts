// Daily 5:30pm ET market brief. Three modes (same shape as /api/email/weekly):
//
//   GET  /api/email/daily                — sends to YOUR account email (logged-in user)
//   GET  /api/email/daily?preview=1      — returns HTML for in-browser preview
//   GET  /api/email/daily                + Authorization: Bearer CRON_SECRET
//                                        — cron entry point, fans out to all users
//
// The brief covers:
//   - Market summary (SPY/QQQ/IWM + your dominant sector ETF + VIX)
//   - Your book's day moves
//   - Today's earnings reactions (from book + mega caps that reported)
//   - Top headlines via Tavily live search
//   - Thesis status changes detected today
//   - Tomorrow's calendar (earnings + macro)
//   - AI synthesis: "what mattered today, what to watch tomorrow"

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { llmComplete } from "@/lib/llm";
import { parseLenientJson } from "@/lib/agent/jsonRepair";
import { getQuotesProvider } from "@/lib/providers/quotes";
import { getNextEarningsBatch } from "@/lib/providers/earnings-calendar";
import { tavilySearch } from "@/lib/providers/tavily";
import { getUserSettings } from "@/lib/settings";
import { getFrameById, pickFrame, FRAMES } from "@/lib/agent/industryFrames";
import { getMacroInRange, type MacroEvent } from "@/lib/macro-calendar";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { buildDailyEmailHtml, buildDailyEmailText, type DailyEmailData } from "@/lib/email-templates";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const SYSTEM = `You are writing a 5:30pm ET market brief for a discretionary investor. The brief lands in their inbox right after the close — terse, opinionated, PM-voiced. Skip filler ("markets traded sideways"); tell them what actually mattered.

Output JSON ONLY:
{
  "headline": "1-sentence punchy summary of the day. The single most important takeaway.",
  "marketAction": "1 paragraph: what moved and WHY. Cite specific index moves and the driver — Fed comments, data print, sector rotation, mega-cap headline. 3-4 sentences max.",
  "bookSummary": "1 paragraph: how the user's specific book performed today. Name winners and losers with % moves. Skip if the book is empty.",
  "topHeadlines": ["2-4 bullets of the day's most important headlines. Each starts with the topic. Cite specific tickers / officials / numbers."],
  "tomorrow": "1 short paragraph: what's on the calendar tomorrow (earnings + macro events) and what the PM should be watching.",
  "watch": ["1-3 specific things to watch tomorrow — concrete, not vague. e.g. 'NVDA pre-market reaction to Trump China tariff' not 'monitor tech sector'."]
}

Rules:
- Be terse. PM doesn't want a recap of every move; they want signal.
- No hedging language. No "investors should consider".
- Cite specific tickers, %s, and dollar levels.
- The bookSummary is optional — if there's no book or no moves worth noting, return an empty string.`;

interface MarketSnapshot {
  symbol: string;
  label: string;
  price: number | null;
  changePct: number | null;
}

interface BookMove {
  symbol: string;
  tier: number | null;
  changePct: number | null;
  price: number | null;
}

interface ThesisFlip {
  symbol: string;
  from: string;
  to: string;
  at: string;
}

interface UpcomingEarnings {
  symbol: string;
  date: string;
  timing: "BH" | "AH" | null;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const preview = url.searchParams.get("preview") === "1";

  // Cron entry point.
  const authHeader = req.headers.get("authorization");
  const cronExpected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (cronExpected && authHeader === cronExpected) {
    return runCronForAllUsers();
  }

  // Logged-in user mode.
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  try {
    const data = await buildDailyDataForUser(supabase, user.user.id);
    if (preview) {
      const html = buildDailyEmailHtml(data);
      return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (!isEmailConfigured()) {
      return NextResponse.json({ ok: false, skipped: true, reason: "RESEND_API_KEY not set" });
    }
    const email = user.user.email;
    if (!email) {
      return NextResponse.json({ error: "User has no email on file" }, { status: 400 });
    }
    const html = buildDailyEmailHtml(data);
    const text = buildDailyEmailText(data);
    const res = await sendEmail({
      to: email,
      subject: `Market brief — ${data.date}`,
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
      const data = await buildDailyDataForUser(admin, userId);
      const html = buildDailyEmailHtml(data);
      const text = buildDailyEmailText(data);
      const res = await sendEmail({
        to: email,
        subject: `Market brief — ${data.date}`,
        html,
        text,
      });
      if (res.ok) sent++;
      else failed++;
    } catch (err) {
      console.error("daily email failed for", userId, err);
      failed++;
    }
  }
  return NextResponse.json({ ok: true, sent, failed, skipped, total: userIds.length });
}

async function buildDailyDataForUser(
  supabase: SupabaseClient,
  userId: string,
): Promise<DailyEmailData> {
  const { data: tickerRows } = await supabase
    .from("tickers")
    .select("symbol,name,tier,sector,industry,frame_id")
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
  }>;

  const settings = await getUserSettings(supabase, userId);
  void settings;

  // 1. Resolve the user's dominant frame for sector ETF context.
  let dominantFrame = FRAMES.generalist;
  if (tickers.length > 0) {
    const counts = new Map<string, number>();
    for (const t of tickers) {
      const f = getFrameById(t.frame_id) ?? pickFrame(t.sector, t.industry);
      counts.set(f.id, (counts.get(f.id) ?? 0) + 1);
    }
    let best = "generalist";
    let bestN = 0;
    for (const [id, n] of counts) {
      if (n > bestN) {
        best = id;
        bestN = n;
      }
    }
    dominantFrame = FRAMES[best] ?? FRAMES.generalist;
  }

  // 2. Pull intraday market snapshot — SPY/QQQ/IWM + dominant sector ETF + VIX.
  const marketSymbols = ["SPY", "QQQ", "IWM", "^VIX"];
  if (!marketSymbols.includes(dominantFrame.benchmarkSymbol)) {
    marketSymbols.push(dominantFrame.benchmarkSymbol);
  }
  const allSyms = Array.from(new Set([...marketSymbols, ...tickers.map((t) => t.symbol)]));
  const quotes = await getQuotesProvider().batchQuotes(allSyms);
  const quoteBySym = new Map(quotes.map((q) => [q.symbol, q]));

  const marketSnapshot: MarketSnapshot[] = marketSymbols.map((sym) => {
    const q = quoteBySym.get(sym);
    return {
      symbol: sym === "^VIX" ? "VIX" : sym,
      label:
        sym === "SPY"
          ? "S&P 500"
          : sym === "QQQ"
          ? "Nasdaq 100"
          : sym === "IWM"
          ? "Russell 2000"
          : sym === "^VIX"
          ? "VIX"
          : sym === dominantFrame.benchmarkSymbol
          ? dominantFrame.benchmarkLabel
          : sym,
      price: q?.price ?? null,
      changePct: q?.changePct ?? null,
    };
  });

  const bookMoves: BookMove[] = tickers
    .map((t) => {
      const q = quoteBySym.get(t.symbol);
      return {
        symbol: t.symbol,
        tier: t.tier,
        changePct: q?.changePct ?? null,
        price: q?.price ?? null,
      };
    })
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));

  // 3. Thesis flips today.
  const startOfDayIso = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").toISOString();
  const { data: thesisRows } = await supabase
    .from("thesis_snapshots")
    .select("symbol,status,generated_at")
    .eq("user_id", userId)
    .gte("generated_at", new Date(Date.now() - 36 * 3600_000).toISOString())
    .order("generated_at", { ascending: true });
  type ThesisRow = { symbol: string; status: string; generated_at: string };
  const theses = (thesisRows ?? []) as ThesisRow[];
  const flips: ThesisFlip[] = [];
  const lastStatus = new Map<string, string>();
  for (const t of theses) {
    const prev = lastStatus.get(t.symbol);
    if (prev && prev !== t.status && t.generated_at >= startOfDayIso) {
      flips.push({ symbol: t.symbol, from: prev, to: t.status, at: t.generated_at });
    }
    lastStatus.set(t.symbol, t.status);
  }

  // 4. Upcoming earnings tomorrow + day after.
  const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);
  const dayAfter = new Date(Date.now() + 48 * 3600_000).toISOString().slice(0, 10);
  const upcoming = tickers.length > 0 ? await getNextEarningsBatch(tickers.map((t) => t.symbol)) : [];
  const upcomingEarnings: UpcomingEarnings[] = upcoming
    .filter((e) => e.earningsDate === tomorrow || e.earningsDate === dayAfter)
    .map((e) => ({ symbol: e.symbol, date: e.earningsDate!, timing: e.timing }));

  // 5. Macro events tomorrow.
  const macroTomorrow: MacroEvent[] = getMacroInRange(tomorrow, dayAfter);

  // 6. Tavily live search — what mattered in markets today.
  let liveAnswer: string | null = null;
  let liveHeadlines: Array<{ title: string; url: string; content: string }> = [];
  try {
    const t = await tavilySearch(
      "US stock market today, what moved and why, Fed, macro, top stocks",
      { maxResults: 6, topic: "news" },
    );
    liveAnswer = t.answer;
    liveHeadlines = t.results.slice(0, 6).map((r) => ({ title: r.title, url: r.url, content: r.content }));
  } catch (err) {
    console.warn("Tavily daily search failed", err);
  }

  // 7. LLM synthesis.
  await ensureBudget(supabase, userId);
  const userPrompt = buildDailyPrompt({
    marketSnapshot,
    bookMoves,
    flips,
    upcomingEarnings,
    macroTomorrow,
    liveAnswer,
    liveHeadlines,
    tickerNames: new Map(tickers.map((t) => [t.symbol, t.name])),
  });

  const completion = await llmComplete({
    purpose: "thesis",
    system: SYSTEM,
    user: userPrompt,
    maxTokens: 1500,
    jsonResponse: true,
  });
  await recordUsage(
    { userId, model: completion.model, endpoint: "email.daily", usage: completion.usage },
    supabase,
  );

  const parsed = parseLenientJson<{
    headline?: string;
    marketAction?: string;
    bookSummary?: string;
    topHeadlines?: string[];
    tomorrow?: string;
    watch?: string[];
  }>(completion.text);

  const dateIso = new Date().toISOString().slice(0, 10);
  const appUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000";

  return {
    date: dateIso,
    appUrl,
    brief: {
      headline: String(parsed.headline ?? "").trim(),
      marketAction: String(parsed.marketAction ?? "").trim(),
      bookSummary: String(parsed.bookSummary ?? "").trim(),
      topHeadlines: Array.isArray(parsed.topHeadlines) ? parsed.topHeadlines.map(String).filter(Boolean) : [],
      tomorrow: String(parsed.tomorrow ?? "").trim(),
      watch: Array.isArray(parsed.watch) ? parsed.watch.map(String).filter(Boolean) : [],
    },
    marketSnapshot,
    bookMoves: bookMoves.slice(0, 12),
    flips,
    upcomingEarnings,
    macroTomorrow,
    liveHeadlines: liveHeadlines.slice(0, 5).map((h) => ({ title: h.title, url: h.url })),
  };
}

function buildDailyPrompt(args: {
  marketSnapshot: MarketSnapshot[];
  bookMoves: BookMove[];
  flips: ThesisFlip[];
  upcomingEarnings: UpcomingEarnings[];
  macroTomorrow: MacroEvent[];
  liveAnswer: string | null;
  liveHeadlines: Array<{ title: string; content: string }>;
  tickerNames: Map<string, string | null>;
}): string {
  const fmt = (n: number | null) => (n == null ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`);
  const lines: string[] = [];

  lines.push(`TODAY: ${new Date().toISOString().slice(0, 10)} (post-close)`);
  lines.push("");
  lines.push("MARKET SNAPSHOT (today's close):");
  for (const m of args.marketSnapshot) {
    lines.push(`  ${m.label} (${m.symbol}): ${m.price != null ? `$${m.price.toFixed(2)}` : "n/a"}, ${fmt(m.changePct)}`);
  }

  if (args.bookMoves.length > 0) {
    lines.push("");
    lines.push("USER'S BOOK (today's moves):");
    for (const b of args.bookMoves.slice(0, 12)) {
      const name = args.tickerNames.get(b.symbol);
      lines.push(`  ${b.symbol}${name ? ` (${name})` : ""} T${b.tier ?? "?"}: ${fmt(b.changePct)} @ $${b.price?.toFixed(2) ?? "?"}`);
    }
  }

  if (args.flips.length > 0) {
    lines.push("");
    lines.push("THESIS STATUS CHANGES TODAY:");
    for (const f of args.flips) {
      lines.push(`  ${f.symbol}: ${f.from} → ${f.to}`);
    }
  }

  if (args.upcomingEarnings.length > 0) {
    lines.push("");
    lines.push("EARNINGS NEXT 2 DAYS:");
    for (const e of args.upcomingEarnings) {
      lines.push(`  ${e.symbol} on ${e.date}${e.timing ? ` (${e.timing})` : ""}`);
    }
  }

  if (args.macroTomorrow.length > 0) {
    lines.push("");
    lines.push("MACRO EVENTS NEXT 2 DAYS:");
    for (const m of args.macroTomorrow) {
      lines.push(`  ${m.date}: ${m.label}`);
    }
  }

  if (args.liveAnswer) {
    lines.push("");
    lines.push("LIVE MARKET CONTEXT (Tavily summary):");
    lines.push(args.liveAnswer);
  }
  if (args.liveHeadlines.length > 0) {
    lines.push("");
    lines.push("LIVE HEADLINES:");
    for (const h of args.liveHeadlines.slice(0, 6)) {
      lines.push(`  - ${h.title}`);
      if (h.content) lines.push(`    ${h.content.slice(0, 240)}`);
    }
  }

  lines.push("");
  lines.push("Produce the JSON brief now. Be terse, opinionated, specific. Skip filler.");

  return lines.join("\n");
}
