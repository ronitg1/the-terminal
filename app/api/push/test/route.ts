// Sends a test push to the caller's subscriptions. Used by the Settings UI
// to verify end-to-end wiring after the user grants permission.
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const res = await sendPushToUser(
    user.user.id,
    {
      title: "The Terminal · test push",
      body: "If you see this, push notifications are wired up correctly.",
      url: "/settings",
      tag: "test",
    },
    supabase,
  );
  return NextResponse.json(res);
}
