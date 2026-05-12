import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getQuotesProvider } from "@/lib/providers/quotes";
import { getOptionsProvider } from "@/lib/providers/options";
import { getShortInterestProvider } from "@/lib/providers/short-interest";
import { getEstimateRevisionsProvider } from "@/lib/providers/estimate-revisions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Avoid hammering Yahoo: only fetch the heavy stuff (options, SI, revisions) every
// few minutes per browser request, but the route itself is dynamic so SWR's stale
// time governs how often the client actually re-fetches.

export interface BulkMetaRow {
  symbol: string;
  quote: { price: number | null; changePct: number | null; high52w: number | null; low52w: number | null };
  impliedMovePct: number | null;
  siPct: number | null;
  daysToCover: number | null;
  revisionDirection: "up" | "down" | "unchanged";
  lastThesis: { status: string; conviction: number | null; generated_at: string } | null;
  impliedMoveHistory: number[];
}

export async function GET() {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });
  const userId = user.user.id;

  const { data: tickers, error } = await supabase
    .from("tickers")
    .select("symbol")
    .order("symbol");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const symbols = (tickers ?? []).map((t) => t.symbol);
  if (symbols.length === 0) return NextResponse.json({ meta: [] });

  const [quotes, sis, moves, revs, theses, earnings] = await Promise.all([
    getQuotesProvider().batchQuotes(symbols),
    Promise.all(symbols.map((s) => getShortInterestProvider().fetch(s))),
    Promise.all(symbols.map((s) => getOptionsProvider().impliedMove(s))),
    Promise.all(symbols.map((s) => getEstimateRevisionsProvider().fetch(s))),
    supabase
      .from("thesis_snapshots")
      .select("symbol,status,conviction,generated_at")
      .eq("user_id", userId)
      .order("generated_at", { ascending: false }),
    supabase
      .from("earnings_events")
      .select("symbol,report_date,implied_move_pct")
      .eq("user_id", userId)
      .order("report_date", { ascending: false }),
  ]);

  const quoteBySym = new Map(quotes.map((q) => [q.symbol, q]));
  const siBySym = new Map(sis.map((s) => [s.symbol, s]));
  const moveBySym = new Map(moves.map((m) => [m.symbol, m]));
  const revBySym = new Map(revs.map((r) => [r.symbol, r]));

  const latestThesisBySym = new Map<string, { status: string; conviction: number | null; generated_at: string }>();
  for (const row of theses.data ?? []) {
    if (!latestThesisBySym.has(row.symbol)) {
      latestThesisBySym.set(row.symbol, {
        status: row.status,
        conviction: row.conviction,
        generated_at: row.generated_at,
      });
    }
  }

  const movesHistBySym = new Map<string, number[]>();
  for (const e of earnings.data ?? []) {
    const arr = movesHistBySym.get(e.symbol) ?? [];
    if (arr.length < 4 && typeof e.implied_move_pct === "number") arr.push(e.implied_move_pct);
    movesHistBySym.set(e.symbol, arr);
  }

  const meta: BulkMetaRow[] = symbols.map((s) => {
    const q = quoteBySym.get(s);
    return {
      symbol: s,
      quote: {
        price: q?.price ?? null,
        changePct: q?.changePct ?? null,
        high52w: q?.high52w ?? null,
        low52w: q?.low52w ?? null,
      },
      impliedMovePct: moveBySym.get(s)?.impliedMovePct ?? null,
      siPct: siBySym.get(s)?.siPct ?? null,
      daysToCover: siBySym.get(s)?.daysToCover ?? null,
      revisionDirection: revBySym.get(s)?.direction ?? "unchanged",
      lastThesis: latestThesisBySym.get(s) ?? null,
      impliedMoveHistory: (movesHistBySym.get(s) ?? []).slice().reverse(),
    };
  });

  return NextResponse.json(
    { meta },
    { headers: { "cache-control": "no-store" } },
  );
}
