import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getMonthToDateSpend } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const month = await getMonthToDateSpend(supabase, user.user.id);
  return NextResponse.json(month);
}
