import { NextResponse, type NextRequest } from "next/server";
import { getQuotesProvider } from "@/lib/providers/quotes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json({ results: [] });
  const results = await getQuotesProvider().search(q);
  return NextResponse.json({ results });
}
