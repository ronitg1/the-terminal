// Cron worker: runs the multi-agent thesis pipeline for ONE (user, symbol)
// pair and sends a push notification on status flips. Invoked by /api/agent/cron
// in parallel — one HTTP call per ticker, so each gets its own 60s function
// budget on Vercel Hobby instead of all tickers sharing one.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { runThesisForSymbol } from "@/lib/agent/run";
import { sendPushToUser } from "@/lib/push";
import { getUserSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  userId: z.string().uuid(),
  symbol: z.string().min(1).max(12),
  companyName: z.string().nullable().optional(),
});

export async function POST(req: NextRequest) {
  // Internal-only endpoint. Authenticated by the same CRON_SECRET bearer
  // the parent cron uses.
  const auth = req.headers.get("authorization");
  const expected = `Bearer ${process.env.CRON_SECRET ?? ""}`;
  if (!process.env.CRON_SECRET || auth !== expected) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { userId, symbol, companyName } = parsed.data;

  const admin = createAdminSupabase();

  try {
    const summary = await runThesisForSymbol({
      symbol,
      companyName: companyName ?? null,
      userId,
      supabase: admin,
    });

    let pushed = false;
    if (
      summary.statusChanged &&
      (summary.output.status === "weakened" || summary.output.status === "broken")
    ) {
      const settings = await getUserSettings(admin, userId);
      if (settings.notifications.thesisStatusChanges) {
        const pushRes = await sendPushToUser(
          userId,
          {
            title: `${symbol} thesis ${summary.output.status}`,
            body:
              summary.output.keyDevelopment ||
              `Status moved ${summary.previousStatus ?? "?"} → ${summary.output.status}`,
            url: `/ai-research?symbol=${encodeURIComponent(symbol)}`,
            tag: `thesis-status-${symbol}`,
            requireInteraction: summary.output.status === "broken",
          },
          admin,
        );
        pushed = (pushRes.sent ?? 0) > 0;
      }
    }

    return NextResponse.json({
      ok: true,
      symbol,
      status: summary.output.status,
      statusChanged: summary.statusChanged,
      pushed,
      durationMs: summary.durationMs,
    });
  } catch (err) {
    console.error("cron-worker failed", symbol, err);
    return NextResponse.json(
      {
        ok: false,
        symbol,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
