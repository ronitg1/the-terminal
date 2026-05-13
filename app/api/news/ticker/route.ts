// Ad-hoc per-ticker news lookup. Hits Finnhub's company-news endpoint via the
// shared NewsProvider so we get articles pre-tagged to the ticker (not generic
// sector roundups).

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getNewsProvider, type NewsHeadline } from "@/lib/providers/news";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface TickerNewsResponse {
  symbol: string;
  headlines: NewsHeadline[];
  fetchedAt: string;
}

export async function GET(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const raw = url.searchParams.get("symbol")?.trim().toUpperCase();
  if (!raw || !/^[A-Z][A-Z0-9.\-]{0,11}$/.test(raw)) {
    return NextResponse.json({ error: "Provide a valid symbol via ?symbol=" }, { status: 400 });
  }
  const hoursBack = Math.min(720, Math.max(12, Number.parseInt(url.searchParams.get("hours") ?? "168", 10)));

  const headlines = await getNewsProvider().forSymbol(raw, hoursBack);
  return NextResponse.json(
    { symbol: raw, headlines, fetchedAt: new Date().toISOString() } satisfies TickerNewsResponse,
    { headers: { "cache-control": "no-store" } },
  );
}
