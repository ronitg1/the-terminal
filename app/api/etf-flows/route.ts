// Sector ETF flow inference. We personalize the universe to the user's book
// frames (so a tech-heavy book sees SOXX/XLK/QQQ; a clean-energy book sees
// ICLN/TAN/QCLN) and always include a small "context" set (SPY, XLE).
//
// Flow inference: Yahoo gives current AUM only — there's no historical AUM
// feed. So we snapshot once per day per ETF and infer weekly flow as:
//
//     priceReturn = price_today / price_baseline - 1
//     expectedAumChange = aum_baseline * priceReturn
//     actualAumChange   = aum_today - aum_baseline
//     impliedFlow       = actualAumChange - expectedAumChange
//
// Positive impliedFlow ≈ net subscriptions; negative ≈ net redemptions. First
// few days after deploying this, flow will be "building" until enough
// snapshots exist.

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getEtfFlowsProvider, type EtfSnapshot } from "@/lib/providers/etf-flows";
import { getQuotesProvider } from "@/lib/providers/quotes";
import { getUserSettings } from "@/lib/settings";
import {
  getFrameById,
  pickFrame,
  FRAMES,
  SECTOR_FRAME_IDS,
  type IndustryFrame,
} from "@/lib/agent/industryFrames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Extra ETFs we surface even if the book doesn't span their frame. SPY = broad
// reference; XLE = always relevant to energy-transition tilted books.
const ALWAYS_INCLUDE = ["SPY"];

// Sub-sector ETFs that don't map cleanly to a frame benchmark but are useful
// per-sector. Keyed by frame id; we add them when the user has tickers in that frame.
const SECTOR_EXTRAS: Record<string, string[]> = {
  "energy-transition": ["TAN", "QCLN"],
  "tech-semis": ["SMH"],
  "banks": ["KRE"],
  "healthcare": ["IBB"],
  "energy-traditional": ["XOP"],
};

export interface EtfFlowRow {
  symbol: string;
  name: string | null;
  frameId: string | null;          // which sector this ETF represents (best-effort)
  frameLabel: string | null;
  aum: number | null;
  price: number | null;
  flowUsd7d: number | null;        // inferred 7-day flow (USD)
  flowPct7d: number | null;        // flowUsd7d / aum_baseline * 100
  return1W: number | null;         // pct
  return1M: number | null;         // pct
  baselineDays: number | null;     // age of the baseline snapshot used (null if no baseline)
  fetchedAt: string;
  source: "live" | "stale" | "building" | "unavailable";
  trend7d: number[];               // last ~5 daily inferred flows when available
}

export interface EtfFlowsResponse {
  rows: EtfFlowRow[];
  bookFrames: string[];            // frame ids represented in the user's book
  fetchedAt: string;
}

interface FlowsRow {
  symbol: string;
  flow_usd: number | null;
  aum: number | null;
  price: number | null;
  fetched_at: string;
}

export async function GET() {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });
  const userId = user.user.id;

  // 1. Build personalized ETF universe from the user's book frames.
  const { data: tickerRows } = await supabase
    .from("tickers")
    .select("symbol,sector,industry,frame_id")
    .eq("user_id", userId);
  type T = { symbol: string; sector: string | null; industry: string | null; frame_id: string | null };
  const tickers = (tickerRows ?? []) as T[];
  const frameIds = new Set<string>();
  for (const t of tickers) {
    const frame: IndustryFrame = getFrameById(t.frame_id) ?? pickFrame(t.sector, t.industry);
    if (SECTOR_FRAME_IDS.includes(frame.id as typeof SECTOR_FRAME_IDS[number])) {
      frameIds.add(frame.id);
    }
  }
  // Always include benchmarks for frames the user owns, plus a few extras.
  const universe = new Set<string>();
  for (const id of frameIds) {
    const f = FRAMES[id];
    if (f) universe.add(f.benchmarkSymbol);
    for (const extra of SECTOR_EXTRAS[id] ?? []) universe.add(extra);
  }
  for (const extra of ALWAYS_INCLUDE) universe.add(extra);
  // If the user has no book yet, fall back to a small generic set.
  if (universe.size === 0) {
    for (const sym of ["SPY", "QQQ", "XLE", "ICLN", "XLF", "XLV"]) universe.add(sym);
  }
  const symbols = Array.from(universe);

  // 2. Fetch live snapshots from Yahoo.
  const provider = getEtfFlowsProvider();
  const live: EtfSnapshot[] = await provider.snapshotBatch(symbols);

  // 3. Snapshot to DB — but only one row per (user, symbol) per day to avoid bloat.
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayStartIso = todayStart.toISOString();
  const { data: todayRowsRaw } = await supabase
    .from("etf_flows")
    .select("symbol")
    .eq("user_id", userId)
    .gte("fetched_at", todayStartIso);
  const insertedToday = new Set(((todayRowsRaw ?? []) as Array<{ symbol: string }>).map((r) => r.symbol));

  const inserts = live
    .filter((s) => s.source === "live" && !insertedToday.has(s.symbol))
    .map((s) => ({
      user_id: userId,
      symbol: s.symbol,
      flow_usd: null,                // populated below once we know baseline
      aum: s.aum,
      price: s.price,
      shares_outstanding: s.sharesOutstanding,
    }));
  if (inserts.length > 0) {
    await supabase.from("etf_flows").insert(inserts);
  }

  // 4. Pull the last ~14 days of snapshots per symbol so we can pick a baseline
  //    and build a small trend sparkline.
  const fourteenAgoIso = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data: historyRaw } = await supabase
    .from("etf_flows")
    .select("symbol,flow_usd,aum,price,fetched_at")
    .eq("user_id", userId)
    .in("symbol", symbols)
    .gte("fetched_at", fourteenAgoIso)
    .order("fetched_at", { ascending: false });
  const history = (historyRaw ?? []) as FlowsRow[];
  const historyBySym = new Map<string, FlowsRow[]>();
  for (const h of history) {
    const arr = historyBySym.get(h.symbol) ?? [];
    arr.push(h);
    historyBySym.set(h.symbol, arr);
  }

  // 5. Fetch price history (1mo) once per symbol — used for 1W/1M return.
  const histories = await Promise.all(
    symbols.map(async (s) => ({ sym: s, hist: await getQuotesProvider().history(s, "1mo") })),
  );
  const priceHistBySym = new Map(histories.map((h) => [h.sym, h.hist]));

  // 6. Build rows.
  const rows: EtfFlowRow[] = live.map((s) => {
    const phist = priceHistBySym.get(s.symbol) ?? [];
    const return1W = pctReturn(phist, 5);
    const return1M = pctReturn(phist, phist.length - 1);

    const past = historyBySym.get(s.symbol) ?? [];
    // Pick baseline ≥7d old; else fallback to oldest available
    const sevenDaysAgo = Date.now() - 7 * 86400_000;
    const baseline = past.find((r) => new Date(r.fetched_at).getTime() <= sevenDaysAgo) ?? past[past.length - 1] ?? null;
    let flowUsd7d: number | null = null;
    let flowPct7d: number | null = null;
    let baselineDays: number | null = null;
    if (baseline && baseline.aum != null && s.aum != null && baseline.price != null && s.price != null && baseline.price > 0) {
      const priceReturn = s.price / baseline.price - 1;
      const expectedAumChange = baseline.aum * priceReturn;
      const actualAumChange = s.aum - baseline.aum;
      flowUsd7d = actualAumChange - expectedAumChange;
      flowPct7d = baseline.aum > 0 ? (flowUsd7d / baseline.aum) * 100 : null;
      baselineDays = Math.max(
        0,
        Math.round((Date.now() - new Date(baseline.fetched_at).getTime()) / 86400_000),
      );
    }

    // Persist today's inferred flow back to the most recent row for this symbol.
    // (Best-effort — non-blocking.)
    if (flowUsd7d != null && past.length > 0 && new Date(past[0].fetched_at).getTime() >= todayStart.getTime()) {
      void supabase
        .from("etf_flows")
        .update({ flow_usd: flowUsd7d })
        .eq("user_id", userId)
        .eq("symbol", s.symbol)
        .gte("fetched_at", todayStartIso);
    }

    // Build a small trend series — the last 5 daily flow_usd values from past
    // (oldest → newest).
    const trend7d = past
      .filter((r) => r.flow_usd != null)
      .slice(0, 5)
      .map((r) => Number(r.flow_usd))
      .reverse();

    // Determine the row's source label.
    let source: EtfFlowRow["source"] = s.source === "live" ? "live" : "unavailable";
    if (s.source !== "live") {
      // Fall back to the freshest stored snapshot.
      const last = past[0];
      if (last && last.aum != null) {
        source = "stale";
      }
    }
    if (source === "live" && flowUsd7d == null) {
      // Live snapshot but not enough history yet to compute flow.
      source = "building";
    }

    // If the LIVE snapshot itself failed (Yahoo missed), hydrate aum/price from DB.
    const last = past[0];
    const aum = s.aum ?? (last?.aum ?? null);
    const price = s.price ?? (last?.price ?? null);

    // Best-effort: get a frame id for this ETF (lookup which frame has it as benchmark or extra).
    let frameId: string | null = null;
    let frameLabel: string | null = null;
    for (const f of Object.values(FRAMES)) {
      if (f.benchmarkSymbol === s.symbol) {
        frameId = f.id;
        frameLabel = f.label;
        break;
      }
    }
    if (!frameId) {
      for (const [fid, extras] of Object.entries(SECTOR_EXTRAS)) {
        if (extras.includes(s.symbol)) {
          frameId = fid;
          frameLabel = FRAMES[fid]?.label ?? null;
          break;
        }
      }
    }

    return {
      symbol: s.symbol,
      name: s.name ?? null,
      frameId,
      frameLabel,
      aum,
      price,
      flowUsd7d,
      flowPct7d,
      return1W,
      return1M,
      baselineDays,
      fetchedAt: s.fetchedAt,
      source,
      trend7d,
    };
  });

  // 7. Sort: book frames first (in frame order), then ALWAYS_INCLUDE, then anything else.
  const bookFrames = Array.from(frameIds);
  rows.sort((a, b) => {
    const aBook = a.frameId && bookFrames.includes(a.frameId) ? 0 : 1;
    const bBook = b.frameId && bookFrames.includes(b.frameId) ? 0 : 1;
    if (aBook !== bBook) return aBook - bBook;
    return a.symbol.localeCompare(b.symbol);
  });

  return NextResponse.json(
    { rows, bookFrames, fetchedAt: new Date().toISOString() } satisfies EtfFlowsResponse,
    { headers: { "cache-control": "no-store" } },
  );
}

function pctReturn(hist: Array<{ date: string; close: number }>, lookback: number): number | null {
  if (hist.length < 2 || lookback < 1) return null;
  const end = hist[hist.length - 1]?.close;
  const startIdx = Math.max(0, hist.length - 1 - lookback);
  const start = hist[startIdx]?.close;
  if (!end || !start) return null;
  return (end / start - 1) * 100;
}
