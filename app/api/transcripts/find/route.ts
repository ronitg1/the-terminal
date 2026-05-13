// Search the web for an earnings transcript for a given ticker. Uses Tavily
// search, biases queries toward Motley Fool / Seeking Alpha / IR pages where
// transcripts typically live, and returns the top 5 candidates with URLs.

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { tavilySearch } from "@/lib/providers/tavily";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TRUSTED_HOSTS = ["fool.com", "seekingalpha.com", "investing.com", "ir.", "investor.", "rev.com"];

export async function GET(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").toUpperCase().trim();
  const quarter = (url.searchParams.get("quarter") ?? "").trim();
  if (!symbol) return NextResponse.json({ error: "symbol required" }, { status: 400 });

  // Pull the company name from the user's book so the query is concrete.
  const { data: tickerRow } = await supabase
    .from("tickers")
    .select("name")
    .eq("user_id", user.user.id)
    .eq("symbol", symbol)
    .maybeSingle();
  const name = (tickerRow as { name: string | null } | null)?.name ?? null;

  // Construct a high-signal query.
  const nameClause = name ? `${name} (${symbol})` : symbol;
  const quarterClause = quarter ? ` ${quarter}` : " latest";
  const query = `${nameClause} earnings call transcript${quarterClause} prepared remarks Q&A`;

  try {
    const res = await tavilySearch(query, { maxResults: 8, topic: "general" });
    // Rank results: trusted hosts first, then by Tavily ordering.
    const ranked = res.results
      .map((r) => ({
        ...r,
        trusted: TRUSTED_HOSTS.some((h) => r.url.includes(h)),
      }))
      .sort((a, b) => Number(b.trusted) - Number(a.trusted));
    return NextResponse.json({
      query,
      results: ranked.slice(0, 5).map((r) => ({
        title: r.title,
        url: r.url,
        publishedDate: r.publishedDate,
        snippet: r.content,
        trusted: r.trusted,
      })),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
