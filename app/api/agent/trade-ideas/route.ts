import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface TradeIdeaRow {
  id: string;
  symbol: string;
  rationale: string | null;
  structure: string | null;
  strike_guidance: string | null;
  sizing: string | null;
  risks: string[];
  trim_on_beat: string | null;
  stop_on_miss: string | null;
  generated_at: string;
  raw: Record<string, unknown> | null;
  is_tracked: boolean;
  tracked_at: string | null;
  closed_at: string | null;
}

export async function GET(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const limit = Math.min(50, Number.parseInt(new URL(req.url).searchParams.get("limit") ?? "20", 10));
  const { data, error } = await supabase
    .from("trade_ideas")
    .select("id,symbol,rationale,structure,strike_guidance,sizing,risks,trim_on_beat,stop_on_miss,raw,generated_at,is_tracked,tracked_at,closed_at")
    .eq("user_id", user.user.id)
    .order("generated_at", { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const ideas = (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      ...row,
      risks: Array.isArray(row.risks) ? (row.risks as string[]) : [],
    };
  }) as TradeIdeaRow[];

  return NextResponse.json({ ideas });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });

  const { error } = await supabase.from("trade_ideas").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
