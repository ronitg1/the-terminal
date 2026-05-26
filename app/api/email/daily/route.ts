// Daily 5:30pm ET market brief. Three modes:
//
//   GET  /api/email/daily                — sends to YOUR account email (logged-in user)
//   GET  /api/email/daily?preview=1      — returns HTML for in-browser preview
//   GET  /api/email/daily                + Authorization: Bearer CRON_SECRET
//                                        — cron entry point, fans out to all users
//
// Brief structure mirrors the original Python script (market_brief.py) — index
// table with MTD/YTD, macro tiles (VIX/DXY/WTI/Gold/BTC + yields), sector ETF
// performance, gainer/decliner cards with reasons, frame-watch section (using
// the user's dominant industry frame), calendar ahead, AI synopsis + market
// tone tag.

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { llmComplete } from "@/lib/llm";
import { parseLenientJson } from "@/lib/agent/jsonRepair";
import { getQuotesProvider } from "@/lib/providers/quotes";
import { getNextEarningsBatch } from "@/lib/providers/earnings-calendar";
import { tavilySearch, type TavilySearchResponse } from "@/lib/providers/tavily";
import { getUserSettings } from "@/lib/settings";
import { getFrameById, pickFrame, FRAMES, type IndustryFrame } from "@/lib/agent/industryFrames";
import { getMacroInRange, type MacroEvent } from "@/lib/macro-calendar";
import { sendEmail, isEmailConfigured } from "@/lib/email";
import { buildDailyEmailHtml, buildDailyEmailText, type DailyEmailData } from "@/lib/email-templates";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Symbols
// ---------------------------------------------------------------------------

const INDEX_SYMBOLS = ["SPY", "QQQ", "IWM", "DIA"] as const;
const INDEX_LABELS: Record<string, { name: string; mtdYtdKey: "sp500" | "nasdaq" | "russell" | "dow" }> = {
  SPY: { name: "S&P 500", mtdYtdKey: "sp500" },
  QQQ: { name: "Nasdaq 100", mtdYtdKey: "nasdaq" },
  IWM: { name: "Russell 2K", mtdYtdKey: "russell" },
  DIA: { name: "Dow Jones", mtdYtdKey: "dow" },
};

const MACRO_SYMBOLS = ["^VIX", "DX-Y.NYB", "CL=F", "GC=F", "BTC-USD", "^FVX", "^TNX", "^TYX"];
const MACRO_LABELS: Record<string, string> = {
  "^VIX": "VIX",
  "DX-Y.NYB": "DXY",
  "CL=F": "WTI Crude",
  "GC=F": "Gold",
  "BTC-USD": "Bitcoin",
  "^FVX": "5Y Yield",
  "^TNX": "10Y Yield",
  "^TYX": "30Y Yield",
};

const SECTOR_ETFS = ["XLK", "XLF", "XLE", "XLV", "XLI", "XLU", "XLY", "XLP", "XLB", "XLRE", "XLC"];
const SECTOR_NAMES: Record<string, string> = {
  XLK: "Technology",
  XLF: "Financials",
  XLE: "Energy",
  XLV: "Healthcare",
  XLI: "Industrials",
  XLU: "Utilities",
  XLY: "Consumer Disc",
  XLP: "Consumer Staples",
  XLB: "Materials",
  XLRE: "Real Estate",
  XLC: "Comms",
};

const TAVILY_QUERIES = [
  "US stock market close today S&P 500 Nasdaq Russell Dow performance",
  "top stock gainers decliners today earnings upgrades analyst news",
  "S&P 500 sector ETF performance today XLK XLF XLE XLV XLI XLU",
  "Treasury yields DXY dollar WTI crude gold Bitcoin today market",
  // Frame-specific query is added dynamically (see buildDailyDataForUser).
];

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM = `You are a sell-side equity research associate producing a daily US equity market brief for a discretionary investor. Adapt the "frame_watch" section to the investor's dominant industry frame (will be specified in the user message).

You receive (a) snapshot quotes for indices, sectors, and macro instruments and (b) live web search results from Tavily. Synthesize into JSON. Be concise, precise, data-driven. NEVER fabricate numbers — use "N/A" if unavailable. Return ONLY valid JSON, no markdown fences.

Schema:
{
  "date": "e.g. Tuesday, May 27 2026",
  "market_tone": "Bullish" | "Bearish" | "Mixed" | "Risk-Off" | "Risk-On",
  "synopsis": "3-5 sentence narrative covering tone, drivers, and key risks",
  "top_headlines": [
    { "topic": "1-3 word category, e.g. FED, EARNINGS, CHINA, OIL, TECH",
      "headline": "one declarative sentence with specific tickers / numbers / officials",
      "tickers": ["optional list of related tickers"]
    }
  ],
  "notable_gainers": [
    { "ticker": "...", "name": "...", "pct": "+X.X%", "reason": "one concise sentence" }
  ],
  "notable_decliners": [
    { "ticker": "...", "name": "...", "pct": "-X.X%", "reason": "one concise sentence" }
  ],
  "calendar_ahead": "Upcoming macro events / Fed speakers / auctions in the next 1-2 days (concrete, no fluff)",
  "frame_watch": "Headlines and themes relevant to the investor's dominant industry frame (will be named in the prompt). N/A if nothing material."
}

Rules:
- top_headlines: 4-6 items covering the day's most important stories. Each is a single declarative sentence — no preamble. Include tickers where relevant.
- 3-5 gainers, 3-5 decliners. Each MUST include a real ticker.
- pct values must come from the snapshot data or the Tavily results — do not invent.
- Skip generic advice like "investors should monitor". Every sentence must add information.`;

// ---------------------------------------------------------------------------
// Pipeline entry points
// ---------------------------------------------------------------------------

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const preview = url.searchParams.get("preview") === "1";

  const authHeader = req.headers.get("authorization");
  const cronExpected = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
  if (cronExpected && authHeader === cronExpected) {
    return runCronForAllUsers();
  }

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
      subject: `📊 Market Brief · ${data.dateLabel} · ${data.brief.market_tone}`,
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
        subject: `📊 Market Brief · ${data.dateLabel} · ${data.brief.market_tone}`,
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

// ---------------------------------------------------------------------------
// Core pipeline
// ---------------------------------------------------------------------------

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

  // 1. Dominant frame — used to label the "frame watch" section + craft a
  //    sector-specific Tavily query.
  let dominantFrame: IndustryFrame = FRAMES.generalist;
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
  const frameQuery =
    dominantFrame.id === "generalist"
      ? "broad market themes mega cap stocks today"
      : `${dominantFrame.label} sector news ${dominantFrame.policyThemes.slice(0, 3).join(" ")} today`;

  // 2. Parallel data fetches.
  const provider = getQuotesProvider();
  const allQuoteSymbols = [...INDEX_SYMBOLS, ...MACRO_SYMBOLS, ...SECTOR_ETFS, ...tickers.map((t) => t.symbol)];

  const [
    quotes,
    spHistory,
    qqqHistory,
    iwmHistory,
    diaHistory,
    tavilyResults,
  ] = await Promise.all([
    provider.batchQuotes(Array.from(new Set(allQuoteSymbols))),
    provider.history("SPY", "1y"),
    provider.history("QQQ", "1y"),
    provider.history("IWM", "1y"),
    provider.history("DIA", "1y"),
    Promise.all(
      [...TAVILY_QUERIES, frameQuery].map(async (q) => {
        try {
          return await tavilySearch(q, { maxResults: 5, topic: "news" });
        } catch (err) {
          console.warn("Tavily query failed", q, err);
          return { query: q, answer: null, results: [] } as TavilySearchResponse;
        }
      }),
    ),
  ]);

  const quoteBySym = new Map(quotes.map((q) => [q.symbol, q]));

  // 3. Index table — day + MTD + YTD.
  const indexRows = INDEX_SYMBOLS.map((sym) => {
    const q = quoteBySym.get(sym);
    const hist =
      sym === "SPY" ? spHistory :
      sym === "QQQ" ? qqqHistory :
      sym === "IWM" ? iwmHistory :
      diaHistory;
    return {
      symbol: sym,
      name: INDEX_LABELS[sym].name,
      level: q?.price ?? null,
      dayChgPct: q?.changePct ?? null,
      mtdPct: computeMtdReturn(hist),
      ytdPct: computeYtdReturn(hist),
    };
  });

  // 4. Macro tiles.
  const macroTiles = MACRO_SYMBOLS.map((sym) => {
    const q = quoteBySym.get(sym);
    return {
      symbol: sym,
      label: MACRO_LABELS[sym] ?? sym,
      value: q?.price ?? null,
      changePct: q?.changePct ?? null,
      isYield: sym.startsWith("^") && sym !== "^VIX",
    };
  });

  // 5. Sector ETFs.
  const sectorRows = SECTOR_ETFS.map((sym) => {
    const q = quoteBySym.get(sym);
    return {
      symbol: sym,
      name: SECTOR_NAMES[sym] ?? sym,
      changePct: q?.changePct ?? null,
    };
  }).sort((a, b) => (b.changePct ?? -999) - (a.changePct ?? -999));

  // 6. User's book performance today.
  const bookMoves = tickers
    .map((t) => {
      const q = quoteBySym.get(t.symbol);
      return {
        symbol: t.symbol,
        name: t.name,
        tier: t.tier,
        price: q?.price ?? null,
        changePct: q?.changePct ?? null,
      };
    })
    .sort((a, b) => Math.abs(b.changePct ?? 0) - Math.abs(a.changePct ?? 0));

  // 7. Thesis flips today.
  const startOfDayIso = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z").toISOString();
  const { data: thesisRows } = await supabase
    .from("thesis_snapshots")
    .select("symbol,status,generated_at")
    .eq("user_id", userId)
    .gte("generated_at", new Date(Date.now() - 36 * 3600_000).toISOString())
    .order("generated_at", { ascending: true });
  type ThesisRow = { symbol: string; status: string; generated_at: string };
  const theses = (thesisRows ?? []) as ThesisRow[];
  const flips: Array<{ symbol: string; from: string; to: string; at: string }> = [];
  const lastStatus = new Map<string, string>();
  for (const t of theses) {
    const prev = lastStatus.get(t.symbol);
    if (prev && prev !== t.status && t.generated_at >= startOfDayIso) {
      flips.push({ symbol: t.symbol, from: prev, to: t.status, at: t.generated_at });
    }
    lastStatus.set(t.symbol, t.status);
  }

  // 8. Upcoming earnings + macro events (next 2 days).
  const tomorrow = new Date(Date.now() + 24 * 3600_000).toISOString().slice(0, 10);
  const dayAfter = new Date(Date.now() + 48 * 3600_000).toISOString().slice(0, 10);
  const upcoming = tickers.length > 0 ? await getNextEarningsBatch(tickers.map((t) => t.symbol)) : [];
  const upcomingEarnings = upcoming
    .filter((e) => e.earningsDate === tomorrow || e.earningsDate === dayAfter)
    .map((e) => ({ symbol: e.symbol, date: e.earningsDate!, timing: e.timing }));
  const macroTomorrow: MacroEvent[] = getMacroInRange(tomorrow, dayAfter);

  // 9. Build the Tavily context block for the LLM.
  const tavilyContext = tavilyResults
    .map((r, i) => {
      const summary = r.answer ? `SUMMARY: ${r.answer}` : "";
      const items = r.results
        .slice(0, 5)
        .map((x) => `- [${x.title}] ${x.content.slice(0, 280)}`)
        .join("\n");
      return `=== QUERY ${i + 1}: ${r.query} ===\n${summary}\n${items}`;
    })
    .join("\n\n");

  // 10. LLM synopsis.
  await ensureBudget(supabase, userId);
  const promptLines: string[] = [];
  const now = new Date();
  const dateLabel = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  promptLines.push(`TODAY: ${dateLabel}`);
  promptLines.push(`DOMINANT FRAME (for frame_watch section): ${dominantFrame.label}`);
  if (dominantFrame.policyThemes.length > 0) {
    promptLines.push(`FRAME POLICY THEMES: ${dominantFrame.policyThemes.slice(0, 4).join(", ")}`);
  }
  promptLines.push("");
  promptLines.push("INDEX SNAPSHOT (close):");
  for (const row of indexRows) {
    promptLines.push(
      `  ${row.name} (${row.symbol}): $${row.level?.toFixed(2) ?? "?"} | day ${fmtPct(row.dayChgPct)} | MTD ${fmtPct(row.mtdPct)} | YTD ${fmtPct(row.ytdPct)}`,
    );
  }
  promptLines.push("");
  promptLines.push("MACRO:");
  for (const m of macroTiles) {
    promptLines.push(`  ${m.label}: ${m.value != null ? m.value.toFixed(2) : "n/a"} (day ${fmtPct(m.changePct)})`);
  }
  promptLines.push("");
  promptLines.push("SECTOR ETFs (sorted):");
  for (const s of sectorRows) {
    promptLines.push(`  ${s.name} (${s.symbol}): ${fmtPct(s.changePct)}`);
  }
  if (bookMoves.length > 0) {
    promptLines.push("");
    promptLines.push("USER'S BOOK (relevant context for synopsis):");
    for (const b of bookMoves.slice(0, 10)) {
      promptLines.push(`  T${b.tier ?? "?"} ${b.symbol}: ${fmtPct(b.changePct)}`);
    }
  }
  if (flips.length > 0) {
    promptLines.push("");
    promptLines.push("USER'S THESIS FLIPS TODAY:");
    for (const f of flips) promptLines.push(`  ${f.symbol}: ${f.from} → ${f.to}`);
  }
  if (upcomingEarnings.length || macroTomorrow.length) {
    promptLines.push("");
    promptLines.push("CALENDAR NEXT 2 DAYS:");
    for (const e of upcomingEarnings) promptLines.push(`  ${e.symbol} earnings ${e.date}${e.timing ? ` (${e.timing})` : ""}`);
    for (const m of macroTomorrow) promptLines.push(`  ${m.label} on ${m.date}`);
  }
  promptLines.push("");
  promptLines.push("LIVE WEB CONTEXT (Tavily, 5 queries):");
  promptLines.push(tavilyContext);
  promptLines.push("");
  promptLines.push(`Produce the JSON brief now. The frame_watch section must be specific to "${dominantFrame.label}" — write "N/A" if nothing material today.`);

  const completion = await llmComplete({
    purpose: "thesis",
    system: SYSTEM,
    user: promptLines.join("\n"),
    maxTokens: 2500,
    jsonResponse: true,
  });
  await recordUsage(
    { userId, model: completion.model, endpoint: "email.daily", usage: completion.usage },
    supabase,
  );

  const raw = parseLenientJson<{
    date?: string;
    market_tone?: string;
    synopsis?: string;
    top_headlines?: Array<{ topic?: string; headline?: string; tickers?: string[] }>;
    notable_gainers?: Array<{ ticker?: string; name?: string; pct?: string; reason?: string }>;
    notable_decliners?: Array<{ ticker?: string; name?: string; pct?: string; reason?: string }>;
    calendar_ahead?: string;
    frame_watch?: string;
  }>(completion.text);

  // Collect a deduped list of Tavily source links to surface under the
  // headlines block. We take the top result from each query (up to 8 total).
  const sourceLinks: Array<{ title: string; url: string; source: string | null }> = [];
  const seenUrls = new Set<string>();
  for (const r of tavilyResults) {
    for (const item of r.results.slice(0, 2)) {
      if (!item.url || seenUrls.has(item.url)) continue;
      seenUrls.add(item.url);
      let host: string | null = null;
      try {
        host = new URL(item.url).hostname.replace(/^www\./, "");
      } catch {
        host = null;
      }
      sourceLinks.push({ title: item.title, url: item.url, source: host });
      if (sourceLinks.length >= 8) break;
    }
    if (sourceLinks.length >= 8) break;
  }

  const appUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || "http://localhost:3000";

  return {
    date: now.toISOString().slice(0, 10),
    dateLabel,
    appUrl,
    frameLabel: dominantFrame.label,
    sourceLinks,
    brief: {
      date: String(raw.date ?? dateLabel),
      market_tone: normalizeTone(raw.market_tone),
      synopsis: String(raw.synopsis ?? "").trim(),
      top_headlines: (raw.top_headlines ?? [])
        .filter((x) => x && (x.topic || x.headline))
        .slice(0, 8)
        .map((x) => ({
          topic: String(x.topic ?? "").trim().toUpperCase(),
          headline: String(x.headline ?? "").trim(),
          tickers: Array.isArray(x.tickers) ? x.tickers.map((t) => String(t).toUpperCase()).filter(Boolean).slice(0, 4) : [],
        })),
      notable_gainers: (raw.notable_gainers ?? [])
        .filter((x) => x && typeof x.ticker === "string")
        .slice(0, 6)
        .map((x) => ({
          ticker: String(x.ticker).toUpperCase(),
          name: String(x.name ?? "").trim(),
          pct: String(x.pct ?? "").trim(),
          reason: String(x.reason ?? "").trim(),
        })),
      notable_decliners: (raw.notable_decliners ?? [])
        .filter((x) => x && typeof x.ticker === "string")
        .slice(0, 6)
        .map((x) => ({
          ticker: String(x.ticker).toUpperCase(),
          name: String(x.name ?? "").trim(),
          pct: String(x.pct ?? "").trim(),
          reason: String(x.reason ?? "").trim(),
        })),
      calendar_ahead: String(raw.calendar_ahead ?? "").trim(),
      frame_watch: String(raw.frame_watch ?? "").trim(),
    },
    indexRows,
    macroTiles,
    sectorRows,
    bookMoves: bookMoves.slice(0, 12),
    flips,
    upcomingEarnings,
    macroTomorrow,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtPct(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "N/A";
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}

function normalizeTone(s: unknown): "Bullish" | "Bearish" | "Mixed" | "Risk-Off" | "Risk-On" {
  const v = String(s ?? "").trim();
  if (["Bullish", "Bearish", "Mixed", "Risk-Off", "Risk-On"].includes(v)) {
    return v as "Bullish" | "Bearish" | "Mixed" | "Risk-Off" | "Risk-On";
  }
  return "Mixed";
}

// Compute month-to-date and year-to-date returns from a daily price history.
function computeMtdReturn(history: Array<{ date: string; close: number }>): number | null {
  if (history.length < 2) return null;
  const last = history[history.length - 1];
  const lastDate = new Date(last.date);
  // Find the last close in the previous month.
  const firstOfMonth = new Date(Date.UTC(lastDate.getUTCFullYear(), lastDate.getUTCMonth(), 1)).toISOString().slice(0, 10);
  // Use the close immediately BEFORE the first of the current month as the baseline.
  let baseline: number | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].date < firstOfMonth) {
      baseline = history[i].close;
      break;
    }
  }
  if (baseline == null || baseline <= 0) return null;
  return (last.close / baseline - 1) * 100;
}

function computeYtdReturn(history: Array<{ date: string; close: number }>): number | null {
  if (history.length < 2) return null;
  const last = history[history.length - 1];
  const lastDate = new Date(last.date);
  const firstOfYear = new Date(Date.UTC(lastDate.getUTCFullYear(), 0, 1)).toISOString().slice(0, 10);
  let baseline: number | null = null;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].date < firstOfYear) {
      baseline = history[i].close;
      break;
    }
  }
  // If we don't have data from before the year started, fall back to the oldest available.
  if (baseline == null) {
    baseline = history[0].close;
  }
  if (baseline == null || baseline <= 0) return null;
  return (last.close / baseline - 1) * 100;
}
