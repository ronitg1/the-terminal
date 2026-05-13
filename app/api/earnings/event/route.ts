// Upsert checklist / debrief data for a (symbol, report_date) earnings event.
// Single endpoint with PATCH semantics — creates the earnings_events row if it
// doesn't exist, otherwise merges the patch into the existing row.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  symbol: z.string().min(1).max(12).transform((s) => s.toUpperCase()),
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "report_date must be YYYY-MM-DD"),
  timing: z.enum(["BH", "AH"]).nullable().optional(),
  eps_estimate: z.number().nullable().optional(),
  rev_estimate: z.number().nullable().optional(),
  implied_move_pct: z.number().nullable().optional(),
  checklist_data: z.record(z.string(), z.unknown()).optional(),
  debrief_data: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase();
  const report_date = url.searchParams.get("report_date") ?? "";
  if (!symbol || !report_date) return NextResponse.json({ error: "symbol and report_date required" }, { status: 400 });

  const { data, error } = await supabase
    .from("earnings_events")
    .select("*")
    .eq("user_id", user.user.id)
    .eq("symbol", symbol)
    .eq("report_date", report_date)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ event: data });
}

export async function PATCH(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { symbol, report_date, ...patch } = parsed.data;

  // Try to find an existing row; upsert behavior.
  const { data: existing } = await supabase
    .from("earnings_events")
    .select("id,checklist_data,debrief_data")
    .eq("user_id", user.user.id)
    .eq("symbol", symbol)
    .eq("report_date", report_date)
    .maybeSingle();

  type Existing = { id: string; checklist_data: Record<string, unknown>; debrief_data: Record<string, unknown> };
  const ex = existing as Existing | null;

  // Merge jsonb patches with existing values so the client can send partial updates.
  const mergedPatch: Record<string, unknown> = { ...patch };
  if (patch.checklist_data !== undefined) {
    mergedPatch.checklist_data = { ...(ex?.checklist_data ?? {}), ...patch.checklist_data };
  }
  if (patch.debrief_data !== undefined) {
    mergedPatch.debrief_data = { ...(ex?.debrief_data ?? {}), ...patch.debrief_data };
  }

  if (ex) {
    const { error } = await supabase.from("earnings_events").update(mergedPatch).eq("id", ex.id);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    return NextResponse.json({ ok: true, id: ex.id });
  }

  const insert = {
    user_id: user.user.id,
    symbol,
    report_date,
    ...mergedPatch,
    checklist_data: (mergedPatch.checklist_data as Record<string, unknown>) ?? {},
    debrief_data: (mergedPatch.debrief_data as Record<string, unknown>) ?? {},
  };
  const { data: inserted, error } = await supabase
    .from("earnings_events")
    .insert(insert)
    .select("id")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ ok: true, id: (inserted as { id: string }).id });
}
