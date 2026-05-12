import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { runThesisForSymbol } from "@/lib/agent/run";
import { BudgetExceededError } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const tierParam = url.searchParams.get("tier");
  const tierFilter = tierParam ? Number.parseInt(tierParam, 10) : null;

  let q = supabase.from("tickers").select("symbol,name,tier").eq("user_id", user.user.id);
  if (tierFilter && [1, 2, 3].includes(tierFilter)) {
    q = q.eq("tier", tierFilter);
  } else {
    q = q.eq("tier", 1); // default: T1 only
  }
  const { data: tickers, error } = await q.order("symbol");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Run sequentially — prompt caching benefits from same-process serial calls,
  // and we avoid stampeding the Anthropic API + Yahoo from a single cron tick.
  const summaries = [];
  let budgetHit = false;
  for (const t of tickers ?? []) {
    try {
      const summary = await runThesisForSymbol({
        symbol: t.symbol as string,
        companyName: (t.name as string | null) ?? null,
        userId: user.user.id,
        supabase,
      });
      summaries.push(summary);
    } catch (err) {
      if (err instanceof BudgetExceededError) {
        // Stop the loop — every subsequent call would fail the same way.
        budgetHit = true;
        summaries.push({ symbol: t.symbol, error: err.message, budgetExceeded: true });
        break;
      }
      console.error("agent run-all failed", t.symbol, err);
      summaries.push({
        symbol: t.symbol,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json(
    { count: summaries.length, summaries, budgetExceeded: budgetHit },
    { status: budgetHit && summaries.length === 1 ? 402 : 200 },
  );
}
