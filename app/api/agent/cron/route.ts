// Vercel cron entry point — runs every 2h on weekdays 9am-6pm ET (see vercel.json).
// Uses the service-role client to iterate every user's T1 tickers.
import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { runThesisForSymbol } from "@/lib/agent/run";
import { sendPushToUser } from "@/lib/push";
import { getUserSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("tickers")
    .select("user_id,symbol,name,tier")
    .eq("tier", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const tickers = (data ?? []) as Array<{ user_id: string; symbol: string; name: string | null; tier: number }>;

  // Cache per-user settings so we only fetch once per user.
  const settingsCache = new Map<string, Awaited<ReturnType<typeof getUserSettings>>>();

  let ok = 0;
  let failed = 0;
  let pushed = 0;
  for (const t of tickers) {
    try {
      const summary = await runThesisForSymbol({
        symbol: t.symbol,
        companyName: t.name,
        userId: t.user_id,
        supabase: admin,
      });
      ok++;

      // Trigger push when a thesis tips from intact/strengthened → weakened/broken.
      if (
        summary.statusChanged &&
        (summary.output.status === "weakened" || summary.output.status === "broken")
      ) {
        let settings = settingsCache.get(t.user_id);
        if (!settings) {
          settings = await getUserSettings(admin, t.user_id);
          settingsCache.set(t.user_id, settings);
        }
        if (settings.notifications.thesisStatusChanges) {
          const res = await sendPushToUser(
            t.user_id,
            {
              title: `${t.symbol} thesis ${summary.output.status}`,
              body: summary.output.keyDevelopment || `Status moved ${summary.previousStatus ?? "?"} → ${summary.output.status}`,
              url: `/ai-research?symbol=${encodeURIComponent(t.symbol)}`,
              tag: `thesis-status-${t.symbol}`,
              requireInteraction: summary.output.status === "broken",
            },
            admin,
          );
          if (res.sent > 0) pushed++;
        }
      }
    } catch (err) {
      console.error("cron run failed", t.symbol, err);
      failed++;
    }
  }

  return NextResponse.json({ ok, failed, pushed, total: tickers.length });
}
