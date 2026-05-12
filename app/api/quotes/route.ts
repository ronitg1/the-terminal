import { NextResponse, type NextRequest } from "next/server";
import { getQuotesProvider } from "@/lib/providers/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const raw = url.searchParams.get("symbols") ?? "";
  const symbols = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (symbols.length === 0) {
    return NextResponse.json({ quotes: [] });
  }
  const quotes = await getQuotesProvider().batchQuotes(symbols);
  return NextResponse.json(
    { quotes },
    { headers: { "cache-control": "no-store" } },
  );
}
