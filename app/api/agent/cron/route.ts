// Cron dispatcher. Fetches every user's T1 tickers and fans out a parallel
// HTTP call per (user, symbol) to /api/agent/cron-worker. Each worker gets
// its own 60s function budget on Vercel Hobby — the dispatcher itself just
// dispatches and aggregates, so it stays well under the platform timeout.

import { NextResponse, type NextRequest } from "next/server";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const tickers = (data ?? []) as Array<{
    user_id: string;
    symbol: string;
    name: string | null;
    tier: number;
  }>;

  // Resolve our own origin. Use the request's forwarded-host where available
  // (Vercel sets this); fall back to NEXT_PUBLIC_SITE_URL.
  const forwardedHost = req.headers.get("x-forwarded-host");
  const origin = forwardedHost
    ? `https://${forwardedHost}`
    : (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin);

  // Per-ticker outcome bucket. Pending entries mean the child function is
  // still running independently — it'll insert its thesis snapshot once done.
  const summaries = tickers.map((t) => ({
    symbol: t.symbol,
    pending: true,
  } as { symbol: string; ok?: boolean; pending?: boolean; error?: string; pushed?: boolean }));

  const dispatched = tickers.map((t, i) =>
    fetch(`${origin}/api/agent/cron-worker`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${process.env.CRON_SECRET}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        userId: t.user_id,
        symbol: t.symbol,
        companyName: t.name,
      }),
      cache: "no-store",
    })
      .then(async (res) => {
        const body = await res.json().catch(() => null);
        summaries[i] = { symbol: t.symbol, ok: res.ok, ...(body ?? {}), pending: false };
      })
      .catch((err) => {
        summaries[i] = {
          symbol: t.symbol,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }),
  );

  // Cap parent wait at 35s — leaves a comfortable margin under the 60s
  // Vercel cap (cold-start + admin Supabase init + DB lookup eats ~5-10s
  // before this point). Children that don't finish in time keep running on
  // their own 60s budget; their thesis snapshots land via direct DB writes.
  await Promise.race([
    Promise.allSettled(dispatched),
    new Promise<void>((resolve) => setTimeout(resolve, 35_000)),
  ]);

  const ok = summaries.filter((s) => s.ok).length;
  const stillPending = summaries.filter((s) => s.pending).length;
  const failed = summaries.length - ok - stillPending;
  const pushed = summaries.filter((s) => s.pushed).length;

  return NextResponse.json({
    ok,
    failed,
    pending: stillPending,
    pushed,
    total: tickers.length,
    summaries,
  });
}
