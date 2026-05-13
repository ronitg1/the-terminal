import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCompanyProfile } from "@/lib/providers/quotes";
import { pickFrame } from "@/lib/agent/industryFrames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const { data, error } = await supabase
    .from("tickers")
    .select("*")
    .order("tier", { ascending: true })
    .order("symbol", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tickers: data ?? [] });
}

const PostSchema = z.object({
  symbol: z.string().min(1).max(12).transform((s) => s.toUpperCase()),
  name: z.string().optional().default(""),
  tier: z.coerce.number().int().min(1).max(3),
  notes: z.string().optional().default(""),
});

export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  // Best-effort industry/sector lookup so the agent picks the right frame on
  // first thesis run. Failure is non-fatal — lazy backfill happens on demand.
  let sector: string | null = null;
  let industry: string | null = null;
  let frameId: string | null = null;
  let benchmarkSymbol: string | null = null;
  try {
    const profile = await getCompanyProfile(parsed.data.symbol);
    sector = profile.sector;
    industry = profile.industry;
    const frame = pickFrame(sector, industry);
    frameId = frame.id;
    benchmarkSymbol = frame.benchmarkSymbol;
  } catch (err) {
    console.warn("getCompanyProfile failed on insert", parsed.data.symbol, err);
  }

  const { data, error } = await supabase
    .from("tickers")
    .insert({
      user_id: user.user.id,
      symbol: parsed.data.symbol,
      name: parsed.data.name || parsed.data.symbol,
      tier: parsed.data.tier as 1 | 2 | 3,
      notes: parsed.data.notes ?? "",
      sector,
      industry,
      frame_id: frameId,
      benchmark_symbol: benchmarkSymbol,
    })
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ticker: data });
}
