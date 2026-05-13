import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface TranscriptListRow {
  id: string;
  symbol: string;
  sentiment_score: number | null;
  tone_delta: string | null;
  guidance_language: string | null;
  key_themes: unknown[];
  dodged_questions: unknown[];
  data: Record<string, unknown>;
  earnings_event_id: string | null;
  generated_at: string;
}

export async function GET(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase().trim() || null;
  const limit = Math.min(50, Number.parseInt(url.searchParams.get("limit") ?? "30", 10));

  let q = supabase
    .from("transcript_analyses")
    .select("id,symbol,sentiment_score,tone_delta,guidance_language,key_themes,dodged_questions,data,earnings_event_id,generated_at")
    .eq("user_id", user.user.id)
    .order("generated_at", { ascending: false })
    .limit(limit);
  if (symbol) q = q.eq("symbol", symbol);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ transcripts: (data ?? []) as TranscriptListRow[] });
}
