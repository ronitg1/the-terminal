import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getQuotesProvider } from "@/lib/providers/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface TrackedIdea {
  id: string;
  symbol: string;
  structure: string | null;
  generated_at: string;
  tracked_at: string;
  entry_spot_price: number | null;
  closed_at: string | null;
  closed_spot_price: number | null;
  current_spot: number | null;
  spot_pct_move: number | null;     // underlying % move since tracking → exit (or current)
  days_held: number;
  status: "open" | "closed";
  // Pulled from the raw idea payload so the dashboard can show what was recommended.
  raw: {
    rationale?: string;
    sizing?: string;
    tradeDetails?: unknown;
    risks?: string[];
    exitPlan?: { trimOnBeat?: string; stopOnMiss?: string };
  } | null;
}

export interface TrackedSummary {
  ideas: TrackedIdea[];
  stats: {
    open: number;
    closed: number;
    winners: number;   // closed with spot_pct_move > 0 (assumes long bias — direction-naive)
    losers: number;
    avgPctMove: number | null;
  };
}

export async function GET() {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  // Pull every idea that's been tracked (open or closed) — open ones need a live quote.
  const { data, error } = await supabase
    .from("trade_ideas")
    .select(
      "id,symbol,structure,generated_at,is_tracked,tracked_at,entry_spot_price,closed_at,closed_spot_price,raw",
    )
    .eq("user_id", user.user.id)
    .or("is_tracked.eq.true,closed_at.not.is.null")
    .order("tracked_at", { ascending: false, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = {
    id: string;
    symbol: string;
    structure: string | null;
    generated_at: string;
    is_tracked: boolean;
    tracked_at: string | null;
    entry_spot_price: number | null;
    closed_at: string | null;
    closed_spot_price: number | null;
    raw: Record<string, unknown> | null;
  };
  const rows = (data ?? []) as Row[];

  // Fetch live quotes only for open positions; closed ones use their stored exit price.
  const openSymbols = Array.from(
    new Set(rows.filter((r) => r.is_tracked && r.closed_at == null).map((r) => r.symbol)),
  );
  const liveQuotes =
    openSymbols.length > 0 ? await getQuotesProvider().batchQuotes(openSymbols) : [];
  const liveBySym = new Map(liveQuotes.map((q) => [q.symbol, q.price]));

  const ideas: TrackedIdea[] = rows
    .filter((r) => r.tracked_at != null) // ignore rows that were never actually tracked
    .map((r) => {
      const status: "open" | "closed" = r.closed_at != null ? "closed" : "open";
      const exitPrice = status === "closed" ? r.closed_spot_price : (liveBySym.get(r.symbol) ?? null);
      const pctMove =
        r.entry_spot_price != null && r.entry_spot_price > 0 && exitPrice != null
          ? ((exitPrice - r.entry_spot_price) / r.entry_spot_price) * 100
          : null;
      const endTs = status === "closed" && r.closed_at ? new Date(r.closed_at).getTime() : Date.now();
      const startTs = r.tracked_at ? new Date(r.tracked_at).getTime() : endTs;
      const daysHeld = Math.max(0, Math.round((endTs - startTs) / 86400000));
      return {
        id: r.id,
        symbol: r.symbol,
        structure: r.structure,
        generated_at: r.generated_at,
        tracked_at: r.tracked_at!,
        entry_spot_price: r.entry_spot_price,
        closed_at: r.closed_at,
        closed_spot_price: r.closed_spot_price,
        current_spot: exitPrice,
        spot_pct_move: pctMove,
        days_held: daysHeld,
        status,
        raw: (r.raw as TrackedIdea["raw"]) ?? null,
      };
    });

  const closed = ideas.filter((i) => i.status === "closed");
  const open = ideas.filter((i) => i.status === "open");
  const withMove = ideas.filter((i) => i.spot_pct_move != null) as Array<TrackedIdea & { spot_pct_move: number }>;
  const stats = {
    open: open.length,
    closed: closed.length,
    winners: closed.filter((i) => directionAwareWinner(i)).length,
    losers: closed.filter((i) => directionAwareLoser(i)).length,
    avgPctMove:
      withMove.length > 0
        ? withMove.reduce((s, i) => s + directionAdjustedMove(i), 0) / withMove.length
        : null,
  };

  return NextResponse.json({ ideas, stats } satisfies TrackedSummary);
}

// Direction-aware helpers: a short_stock / long_put / bear_put_spread idea
// "wins" when the underlying GOES DOWN.
function isBearish(structure: string | null | undefined): boolean {
  if (!structure) return false;
  return /short_stock|long_put|bear_/.test(structure);
}
function directionAdjustedMove(i: TrackedIdea & { spot_pct_move: number }): number {
  return isBearish(i.structure) ? -i.spot_pct_move : i.spot_pct_move;
}
function directionAwareWinner(i: TrackedIdea): boolean {
  if (i.spot_pct_move == null) return false;
  return directionAdjustedMove(i as TrackedIdea & { spot_pct_move: number }) > 0;
}
function directionAwareLoser(i: TrackedIdea): boolean {
  if (i.spot_pct_move == null) return false;
  return directionAdjustedMove(i as TrackedIdea & { spot_pct_move: number }) < 0;
}
