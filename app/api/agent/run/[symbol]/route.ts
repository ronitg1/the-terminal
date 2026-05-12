import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { runThesisForSymbol } from "@/lib/agent/run";
import { BudgetExceededError } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(_req: NextRequest, { params }: { params: { symbol: string } }) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const symbol = params.symbol.toUpperCase();
  const { data: ticker } = await supabase
    .from("tickers")
    .select("symbol,name")
    .eq("user_id", user.user.id)
    .eq("symbol", symbol)
    .maybeSingle();

  if (!ticker) return NextResponse.json({ error: "Ticker not in your book" }, { status: 404 });

  try {
    const summary = await runThesisForSymbol({
      symbol,
      companyName: ticker.name as string | null,
      userId: user.user.id,
      supabase,
    });
    return NextResponse.json(summary);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message, month: err.month }, { status: 402 });
    }
    console.error("agent run failed", symbol, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
