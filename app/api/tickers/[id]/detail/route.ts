import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getQuotesProvider } from "@/lib/providers/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: ticker, error: tErr } = await supabase
    .from("tickers")
    .select("*")
    .eq("id", params.id)
    .single();
  if (tErr || !ticker) return NextResponse.json({ error: tErr?.message ?? "not found" }, { status: 404 });

  const [{ data: thesis }, { data: si }, { data: rev }, { data: transcripts }, history] = await Promise.all([
    supabase
      .from("thesis_snapshots")
      .select("*")
      .eq("symbol", ticker.symbol)
      .order("generated_at", { ascending: false })
      .limit(1),
    supabase
      .from("short_interest")
      .select("si_pct,fetched_at")
      .eq("symbol", ticker.symbol)
      .order("fetched_at", { ascending: false })
      .limit(90),
    supabase
      .from("estimate_revisions")
      .select("*")
      .eq("symbol", ticker.symbol)
      .order("fetched_at", { ascending: false })
      .limit(10),
    supabase
      .from("transcript_analyses")
      .select("id,sentiment_score,tone_delta,data,generated_at")
      .eq("symbol", ticker.symbol)
      .order("generated_at", { ascending: false })
      .limit(8),
    getQuotesProvider().history(ticker.symbol, "1y"),
  ]);

  return NextResponse.json({
    ticker,
    latestThesis: thesis?.[0] ?? null,
    shortInterestHistory: si ?? [],
    estimateRevisions: rev ?? [],
    transcripts: transcripts ?? [],
    priceHistory: history,
  });
}
