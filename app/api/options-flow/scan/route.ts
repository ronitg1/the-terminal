// Cron entry point — scans every user's T1 tickers for unusual options activity
// when earnings are within 10 days, and pushes an alert if so. Yahoo doesn't
// expose a true unusual-activity tape; "unusual" here means call/put volume
// ratio outside [0.5, 2.0] OR a contract with vol/OI > 5x and volume ≥ 200.

import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { getOptionsProvider, type ChainSummary } from "@/lib/providers/options";
import { getNextEarnings } from "@/lib/providers/earnings-calendar";
import { getUserSettings } from "@/lib/settings";
import { sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const VOL_OI_THRESHOLD = 5;
const VOL_THRESHOLD = 200;

function classifyUnusual(summary: ChainSummary): { unusual: boolean; reason: string } {
  const cpv = summary.callPutVolumeRatio;
  if (cpv != null && (cpv >= 2 || cpv <= 0.5)) {
    return {
      unusual: true,
      reason:
        cpv >= 2
          ? `Call/put volume ${cpv.toFixed(2)}x — calls dominant`
          : `Put/call volume ${(1 / cpv).toFixed(2)}x — puts dominant`,
    };
  }
  const hot = summary.notableContracts.find(
    (c) => c.volOiRatio >= VOL_OI_THRESHOLD && c.volume >= VOL_THRESHOLD,
  );
  if (hot) {
    return {
      unusual: true,
      reason: `${hot.type.toUpperCase()} ${hot.strike} exp ${hot.expiry} — vol ${hot.volume.toLocaleString()} on OI ${hot.openInterest.toLocaleString()} (${hot.volOiRatio.toFixed(1)}x)`,
    };
  }
  return { unusual: false, reason: "" };
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const admin = createAdminSupabase();
  const { data, error } = await admin
    .from("tickers")
    .select("user_id,symbol,tier")
    .eq("tier", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const tickers = (data ?? []) as Array<{ user_id: string; symbol: string; tier: number }>;

  const optProvider = getOptionsProvider();
  const settingsCache = new Map<string, Awaited<ReturnType<typeof getUserSettings>>>();

  let scanned = 0;
  let preEarnings = 0;
  let pushed = 0;
  for (const t of tickers) {
    scanned++;
    try {
      const earn = await getNextEarnings(t.symbol);
      if (!earn.daysUntil || earn.daysUntil < 0 || earn.daysUntil > 10) continue;
      preEarnings++;

      // Use the earnings expiry when possible.
      const expiries = await optProvider.expiries(t.symbol).catch(() => [] as string[]);
      const chosen = earn.earningsDate
        ? expiries.filter((d) => d >= earn.earningsDate!).sort()[0]
        : undefined;
      const summary = await optProvider.chainSummary(t.symbol, chosen);
      if (!summary) continue;

      const judgement = classifyUnusual(summary);
      if (!judgement.unusual) continue;

      let settings = settingsCache.get(t.user_id);
      if (!settings) {
        settings = await getUserSettings(admin, t.user_id);
        settingsCache.set(t.user_id, settings);
      }
      if (!settings.notifications.unusualOptionsFlow) continue;

      const res = await sendPushToUser(
        t.user_id,
        {
          title: `${t.symbol} unusual options · earnings in ${earn.daysUntil}d`,
          body: judgement.reason,
          url: `/options-flow`,
          tag: `flow-${t.symbol}`,
        },
        admin,
      );
      if (res.sent > 0) pushed++;
    } catch (err) {
      console.error("options-flow scan failed", t.symbol, err);
    }
  }

  return NextResponse.json({ scanned, preEarnings, pushed });
}
