// Run-all T1 thesis refresh. Fans out to /api/agent/run/[symbol] in parallel
// so each ticker gets its own 60s Vercel function invocation (Hobby plan cap)
// instead of all tickers sharing one 60s budget sequentially.
//
// Parent wall time stays under 60s because the fan-out runs in parallel — if
// each ticker takes 30s, the parent waits 30s, not 30s × N.

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const tierParam = url.searchParams.get("tier");
  const tierFilter = tierParam ? Number.parseInt(tierParam, 10) : null;

  let q = supabase.from("tickers").select("symbol,name,tier").eq("user_id", user.user.id);
  if (tierFilter && [1, 2, 3].includes(tierFilter)) {
    q = q.eq("tier", tierFilter);
  } else {
    q = q.eq("tier", 1);
  }
  const { data: tickers, error } = await q.order("symbol");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Resolve own origin so we can call our own /api/agent/run/[symbol] route.
  // Prefer the request origin (handles preview deployments + custom domains);
  // fall back to NEXT_PUBLIC_SITE_URL for environments where origin isn't
  // reliably populated.
  const origin =
    req.headers.get("origin") ??
    req.headers.get("x-forwarded-host")
      ? `https://${req.headers.get("x-forwarded-host")}`
      : process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;

  // Forward cookies so the downstream route authenticates as the same user.
  const cookieHeader = req.headers.get("cookie") ?? "";

  const fanoutResults = await Promise.allSettled(
    (tickers ?? []).map(async (t) => {
      const symbol = t.symbol as string;
      try {
        const res = await fetch(`${origin}/api/agent/run/${encodeURIComponent(symbol)}`, {
          method: "POST",
          headers: {
            cookie: cookieHeader,
            "content-type": "application/json",
          },
          cache: "no-store",
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          return {
            symbol,
            error: typeof body?.error === "string" ? body.error : `HTTP ${res.status}`,
            status: res.status,
            budgetExceeded: res.status === 402,
          };
        }
        return body;
      } catch (err) {
        return {
          symbol,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  const summaries = fanoutResults.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : { error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
  );
  const budgetHit = summaries.some((s) => s && (s as { budgetExceeded?: boolean }).budgetExceeded);

  return NextResponse.json(
    { count: summaries.length, summaries, budgetExceeded: budgetHit },
    { status: 200 },
  );
}
