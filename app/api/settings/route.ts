import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { getUserSettings, upsertUserSettings, type UserSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });
  const settings = await getUserSettings(supabase, user.user.id);
  return NextResponse.json({ settings });
}

const PatchSchema = z.object({
  peerGroups: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        members: z.array(z.string().min(1).max(12).transform((s) => s.toUpperCase())).max(50),
        affects: z.array(z.string().min(1).max(12).transform((s) => s.toUpperCase())).max(50),
      }),
    )
    .optional(),
  macroSearchTerms: z.array(z.string().min(1).max(120)).max(40).optional(),
  megaCaps: z.array(z.string().min(1).max(12).transform((s) => s.toUpperCase())).max(40).optional(),
  bookSizeUsd: z.number().positive().max(1_000_000_000).optional(),
  notifications: z
    .object({
      thesisStatusChanges: z.boolean().optional(),
      peerReadthroughsUrgent: z.boolean().optional(),
      unusualOptionsFlow: z.boolean().optional(),
    })
    .optional(),
});

export async function PATCH(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const updated = await upsertUserSettings(supabase, user.user.id, parsed.data as Partial<UserSettings>);
  return NextResponse.json({ settings: updated });
}
