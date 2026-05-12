import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getQuotesProvider } from "@/lib/providers/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BodySchema = z.object({
  action: z.enum(["track", "untrack", "close", "reopen"]),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { data: idea, error: fetchErr } = await supabase
    .from("trade_ideas")
    .select("id,symbol,is_tracked,tracked_at,entry_spot_price")
    .eq("id", params.id)
    .eq("user_id", user.user.id)
    .maybeSingle();
  if (fetchErr || !idea) {
    return NextResponse.json({ error: fetchErr?.message ?? "not found" }, { status: 404 });
  }

  const ideaTyped = idea as { id: string; symbol: string; is_tracked: boolean; tracked_at: string | null; entry_spot_price: number | null };

  // Fetch the current spot once — used to set entry price on track and exit price on close.
  const quote = (await getQuotesProvider().batchQuotes([ideaTyped.symbol]))[0] ?? null;
  const spot = quote?.price ?? null;

  let patch: Record<string, unknown> = {};
  switch (parsed.data.action) {
    case "track":
      patch = {
        is_tracked: true,
        // Preserve existing entry price if user is re-tracking
        tracked_at: ideaTyped.tracked_at ?? new Date().toISOString(),
        entry_spot_price: ideaTyped.entry_spot_price ?? spot,
        closed_at: null,
        closed_spot_price: null,
      };
      break;
    case "untrack":
      patch = {
        is_tracked: false,
        tracked_at: null,
        entry_spot_price: null,
        closed_at: null,
        closed_spot_price: null,
      };
      break;
    case "close":
      patch = {
        is_tracked: false,
        closed_at: new Date().toISOString(),
        closed_spot_price: spot,
      };
      break;
    case "reopen":
      patch = {
        is_tracked: true,
        closed_at: null,
        closed_spot_price: null,
      };
      break;
  }
  if (parsed.data.notes !== undefined) {
    patch.tracking_notes = parsed.data.notes;
  }

  const { error: updateErr } = await supabase
    .from("trade_ideas")
    .update(patch)
    .eq("id", params.id);
  if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
