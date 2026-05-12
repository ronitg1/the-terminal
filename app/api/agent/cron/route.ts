// Vercel cron entry point — runs every 2h on weekdays 9am-6pm ET (see vercel.json).
// Uses the service-role client to iterate every user's T1 tickers.
import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { runThesisForSymbol } from "@/lib/agent/run";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("tickers")
    .select("user_id,symbol,name,tier")
    .eq("tier", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tickers = (data ?? []) as Array<{ user_id: string; symbol: string; name: string | null; tier: number }>;

  let ok = 0;
  let failed = 0;
  for (const t of tickers) {
    try {
      await runThesisForSymbol({
        symbol: t.symbol,
        companyName: t.name,
        userId: t.user_id,
        supabase: admin,
      });
      ok++;
    } catch (err) {
      console.error("cron run failed", t.symbol, err);
      failed++;
    }
  }

  return NextResponse.json({ ok, failed, total: tickers.length });
}
