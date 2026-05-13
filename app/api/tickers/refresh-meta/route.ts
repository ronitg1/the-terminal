// Bulk-refresh industry/sector/frame for the user's tickers. Used on Settings
// to backfill existing tickers added before the industry-frame system landed.

import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyProfile } from "@/lib/providers/quotes";
import { pickFrame } from "@/lib/agent/industryFrames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: tickers, error } = await supabase
    .from("tickers")
    .select("id,symbol,sector,industry,frame_id,benchmark_symbol")
    .eq("user_id", user.user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Row = { id: string; symbol: string; sector: string | null; industry: string | null; frame_id: string | null; benchmark_symbol: string | null };
  const rows = (tickers ?? []) as Row[];

  const updates: Array<{ id: string; symbol: string; sector: string | null; industry: string | null; frameId: string; benchmarkSymbol: string }> = [];
  for (const t of rows) {
    const profile = await getCompanyProfile(t.symbol);
    const sector = profile.sector ?? t.sector;
    const industry = profile.industry ?? t.industry;
    const frame = pickFrame(sector, industry);
    updates.push({
      id: t.id,
      symbol: t.symbol,
      sector,
      industry,
      frameId: frame.id,
      benchmarkSymbol: frame.benchmarkSymbol,
    });
  }

  // Apply updates in parallel.
  const results = await Promise.all(
    updates.map((u) =>
      supabase
        .from("tickers")
        .update({
          sector: u.sector,
          industry: u.industry,
          frame_id: u.frameId,
          benchmark_symbol: u.benchmarkSymbol,
        })
        .eq("id", u.id),
    ),
  );
  const failures = results.filter((r) => r.error).length;

  return NextResponse.json({
    updated: updates.length - failures,
    failed: failures,
    tickers: updates.map((u) => ({
      symbol: u.symbol,
      sector: u.sector,
      industry: u.industry,
      frame: u.frameId,
      benchmark: u.benchmarkSymbol,
    })),
  });
}
