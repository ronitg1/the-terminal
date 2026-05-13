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

  const results = await Promise.allSettled(
    tickers.map(async (t) => {
      const res = await fetch(`${origin}/api/agent/cron-worker`, {
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
      });
      const body = await res.json().catch(() => null);
      return {
        ok: res.ok,
        symbol: t.symbol,
        status: res.status,
        ...(body ?? {}),
      };
    }),
  );

  const summaries = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { ok: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
  );

  const ok = summaries.filter((s) => (s as { ok?: boolean }).ok).length;
  const failed = summaries.length - ok;
  const pushed = summaries.filter((s) => (s as { pushed?: boolean }).pushed).length;

  return NextResponse.json({ ok, failed, pushed, total: tickers.length, summaries });
}
