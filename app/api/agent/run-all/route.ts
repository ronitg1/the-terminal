// Run-all T1 thesis refresh. Fans out to /api/agent/run/[symbol] in parallel
// so each ticker gets its own 60s Vercel function invocation. The parent
// dispatcher caps its own wait at 50s — anything still in-flight when the
// cap hits is reported as `pending: true` and the child function keeps
// processing independently. The UI polls /api/agent/feed to pick up the
// snapshots when they land.

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const PARENT_WAIT_MS = 50_000; // leave 10s margin under the 60s platform cap

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

  const forwardedHost = req.headers.get("x-forwarded-host");
  const origin = forwardedHost
    ? `https://${forwardedHost}`
    : (process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin);
  const cookieHeader = req.headers.get("cookie") ?? "";

  // Shared per-ticker outcome bucket. Mutated as each child resolves.
  const summaries = (tickers ?? []).map((t) => ({
    symbol: t.symbol as string,
    pending: true,
  } as { symbol: string; pending?: boolean; error?: string; status?: string; statusChanged?: boolean; durationMs?: number }));

  const dispatched = (tickers ?? []).map((t, i) =>
    fetch(`${origin}/api/agent/run/${encodeURIComponent(t.symbol as string)}`, {
      method: "POST",
      headers: { cookie: cookieHeader, "content-type": "application/json" },
      cache: "no-store",
    })
      .then(async (r) => {
        const body = await r.json().catch(() => null);
        if (!r.ok) {
          summaries[i] = {
            symbol: t.symbol as string,
            error: typeof body?.error === "string" ? body.error : `HTTP ${r.status}`,
            ...(r.status === 402 ? { budgetExceeded: true as never } : {}),
          };
        } else {
          summaries[i] = {
            symbol: t.symbol as string,
            ...(body ?? {}),
            pending: false,
          };
        }
      })
      .catch((err) => {
        summaries[i] = {
          symbol: t.symbol as string,
          error: err instanceof Error ? err.message : String(err),
        };
      }),
  );

  // Wait either for all children to complete OR for our 50s cap, whichever
  // comes first. After this, summaries[] reflects everything resolved so far;
  // anything still pending will keep running in its own child function.
  await Promise.race([
    Promise.allSettled(dispatched),
    new Promise<void>((resolve) => setTimeout(resolve, PARENT_WAIT_MS)),
  ]);

  const stillPending = summaries.filter((s) => s.pending).length;
  return NextResponse.json(
    { count: summaries.length, completed: summaries.length - stillPending, pending: stillPending, summaries },
    { status: 200 },
  );
}
