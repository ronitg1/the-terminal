import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getEtfFlowsProvider } from "@/lib/providers/etf-flows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ETF_SYMBOLS = ["ICLN", "TAN", "XLE", "QCLN"] as const;

export async function GET() {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });
  const userId = user.user.id;

  const live = await Promise.all(ETF_SYMBOLS.map((s) => getEtfFlowsProvider().weekly(s)));

  // Persist successful live fetches so we can show stale data on future failures.
  const inserts = live
    .filter((r) => r.source === "live" && (r.flowUsd != null || r.aum != null))
    .map((r) => ({
      user_id: userId,
      symbol: r.symbol,
      flow_usd: r.flowUsd,
      aum: r.aum,
    }));
  if (inserts.length > 0) {
    await supabase.from("etf_flows").insert(inserts);
  }

  // For any unavailable rows, hydrate from last known DB row.
  const rows = await Promise.all(
    live.map(async (r) => {
      if (r.source === "live") return r;
      const { data } = await supabase
        .from("etf_flows")
        .select("symbol,flow_usd,aum,fetched_at")
        .eq("symbol", r.symbol)
        .order("fetched_at", { ascending: false })
        .limit(1);
      const last = data?.[0];
      if (!last) return r;
      return {
        symbol: r.symbol,
        flowUsd: last.flow_usd,
        aum: last.aum,
        fetchedAt: last.fetched_at,
        source: "stale" as const,
      };
    }),
  );

  // 4-week trend per ETF from DB
  const trends = await Promise.all(
    ETF_SYMBOLS.map(async (s) => {
      const { data } = await supabase
        .from("etf_flows")
        .select("flow_usd,fetched_at")
        .eq("symbol", s)
        .order("fetched_at", { ascending: false })
        .limit(4);
      return { symbol: s, points: (data ?? []).map((d) => d.flow_usd ?? 0).reverse() };
    }),
  );

  return NextResponse.json({ rows, trends });
}
