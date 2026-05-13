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
  const nowIso = new Date().toISOString();

  // First, try the fast upsert path (relies on migration 0011's unique
  // constraint on user_id,date). If that fails because the constraint is
  // missing, fall back to a manual select-then-insert/update so saves work
  // regardless of migration state.
  const upsertRow = {
    user_id: user.user.id,
    date,
    content: content ?? "",
    tags: tags ?? [],
    updated_at: nowIso,
  };

  const upsert = await supabase
    .from("journal_entries")
    .upsert(upsertRow, { onConflict: "user_id,date" })
    .select("*")
    .single();

  if (!upsert.error) {
    return NextResponse.json({ entry: upsert.data });
  }

  // Fall back to manual upsert if the constraint is missing or upsert fails.
  // 1. Look up existing entry for (user, date)
  const existing = await supabase
    .from("journal_entries")
    .select("id")
    .eq("user_id", user.user.id)
    .eq("date", date)
    .maybeSingle();

  if (existing.error) {
    return NextResponse.json(
      { error: `Save failed: ${existing.error.message}` },
      { status: 400 },
    );
  }

  if (existing.data) {
    // 2a. Exists → UPDATE
    const updatePatch: Record<string, unknown> = { updated_at: nowIso };
    if (content !== undefined) updatePatch.content = content;
    if (tags !== undefined) updatePatch.tags = tags;
    const upd = await supabase
      .from("journal_entries")
      .update(updatePatch)
      .eq("id", existing.data.id)
      .select("*")
      .single();
    if (upd.error) {
      return NextResponse.json({ error: `Save failed: ${upd.error.message}` }, { status: 400 });
    }
    return NextResponse.json({ entry: upd.data });
  }

  // 2b. Doesn't exist → INSERT
  const ins = await supabase
    .from("journal_entries")
    .insert(upsertRow)
    .select("*")
    .single();
  if (ins.error) {
    // Most likely cause: migration 0011's updated_at column doesn't exist yet.
    // Retry without updated_at as a last resort.
    const retryRow = { user_id: user.user.id, date, content: content ?? "", tags: tags ?? [] };
    const retry = await supabase
      .from("journal_entries")
      .insert(retryRow)
      .select("*")
      .single();
    if (retry.error) {
      return NextResponse.json(
        { error: `Save failed: ${retry.error.message}. If this persists, apply supabase/migrations/0011_journal_extensions.sql.` },
        { status: 400 },
      );
    }
    return NextResponse.json({ entry: retry.data });
  }
  return NextResponse.json({ entry: ins.data });
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
