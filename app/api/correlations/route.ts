import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getQuotesProvider } from "@/lib/providers/quotes";
import { correlationMatrix } from "@/lib/math/correlation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: tickers, error } = await supabase.from("tickers").select("symbol").order("symbol");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const symbols = (tickers ?? []).map((t) => t.symbol);
  if (symbols.length < 2) return NextResponse.json({ symbols: [], matrix: [] });

  // Fetch ~3 months of daily closes (≈ 60 trading days)
  const histories = await Promise.all(symbols.map((s) => getQuotesProvider().history(s, "3mo")));

  const seriesBySymbol: Record<string, number[]> = {};
  symbols.forEach((s, i) => {
    seriesBySymbol[s] = histories[i].slice(-60).map((r) => r.close);
  });

  const { symbols: outSyms, matrix } = correlationMatrix(seriesBySymbol);
  return NextResponse.json(
    { symbols: outSyms, matrix },
    { headers: { "cache-control": "no-store" } },
  );
}
