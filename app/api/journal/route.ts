import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface JournalEntry {
  id: string;
  date: string;
  content: string;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface JournalDay {
  date: string;
  has_content: boolean;
  tags: string[];
}

// GET /api/journal — return all dates that have an entry (calendar dots),
//   OR a single entry when ?date=YYYY-MM-DD
// GET /api/journal?from=&to= — entries in a date range with content
export async function GET(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const date = url.searchParams.get("date");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const search = url.searchParams.get("search");

  if (date) {
    const { data, error } = await supabase
      .from("journal_entries")
      .select("*")
      .eq("user_id", user.user.id)
      .eq("date", date)
      .maybeSingle();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ entry: data });
  }

  if (search) {
    // Full-text search across content.
    const { data, error } = await supabase
      .from("journal_entries")
      .select("id,date,content,tags,updated_at")
      .eq("user_id", user.user.id)
      .ilike("content", `%${search}%`)
      .order("date", { ascending: false })
      .limit(50);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ results: data ?? [] });
  }

  // Default: return all dates that have an entry — used by the calendar to dot days.
  let q = supabase
    .from("journal_entries")
    .select("date,tags,content")
    .eq("user_id", user.user.id);
  if (from) q = q.gte("date", from);
  if (to) q = q.lte("date", to);
  const { data, error } = await q.order("date", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const days: JournalDay[] = (data ?? []).map((r) => ({
    date: (r as { date: string }).date,
    has_content: ((r as { content: string }).content ?? "").trim().length > 0,
    tags: (r as { tags: string[] }).tags ?? [],
  }));
  return NextResponse.json({ days });
}

const UpsertSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  content: z.string().max(50_000).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});

export async function PATCH(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = UpsertSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { date, content, tags } = parsed.data;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (content !== undefined) patch.content = content;
  if (tags !== undefined) patch.tags = tags;

  // Upsert by (user_id, date).
  const { data, error } = await supabase
    .from("journal_entries")
    .upsert(
      { user_id: user.user.id, date, content: content ?? "", tags: tags ?? [], ...patch },
      { onConflict: "user_id,date" },
    )
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ entry: data });
}

export async function DELETE(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const date = new URL(req.url).searchParams.get("date");
  if (!date) return NextResponse.json({ error: "date required" }, { status: 400 });

  const { error } = await supabase
    .from("journal_entries")
    .delete()
    .eq("user_id", user.user.id)
    .eq("date", date);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
