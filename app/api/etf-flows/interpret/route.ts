// AI interpretation of sector ETF flows + price action vs the user's book.
// Reuses the data returned by /api/etf-flows so we don't double-fetch Yahoo.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { llmComplete } from "@/lib/llm";
import { parseLenientJson } from "@/lib/agent/jsonRepair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const RowSchema = z.object({
  symbol: z.string(),
  name: z.string().nullable(),
  frameId: z.string().nullable(),
  frameLabel: z.string().nullable(),
  aum: z.number().nullable(),
  price: z.number().nullable(),
  flowUsd7d: z.number().nullable(),
  flowPct7d: z.number().nullable(),
  return1W: z.number().nullable(),
  return1M: z.number().nullable(),
  baselineDays: z.number().nullable(),
  source: z.string(),
});

const BodySchema = z.object({
  rows: z.array(RowSchema).min(1),
});

const SYSTEM = `You are a sector-rotation strategist briefing a discretionary fund PM.

You are given a snapshot of sector ETF flows + 1-week / 1-month price action. Flows are INFERRED from AUM-delta minus price-return (not direct creation/redemption tape). Treat them as a noisy signal — if baselineDays is short or the absolute USD flow is small relative to AUM, lower confidence.

Output JSON ONLY:
{
  "headline": "1-sentence top-line on where money is moving",
  "leaders": ["2-4 bullets: sectors with strongest inflows AND/OR price strength — cite the ETF symbols and numbers"],
  "laggards": ["2-4 bullets: sectors with outflows AND/OR weakness — cite specific ETFs and numbers"],
  "bookImplications": ["2-4 bullets, EACH starting with the affected sector or ticker. What does this rotation mean for the PM's book? Be specific."],
  "watch": ["2-3 bullets: rotations to monitor next 1-2 weeks"]
}

Rules:
- Cite specific ETF symbols and the flow $ + 1W % from the data.
- Skip generic 'risk-on/risk-off' framing unless backed by the numbers.
- When flows and price diverge (e.g. inflows + price down), call it out — it's a setup signal.
- Be PM-voiced: terse, opinionated, no hedging.`;

export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    await ensureBudget(supabase, user.user.id);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message, month: err.month }, { status: 402 });
    }
    throw err;
  }

  const { data: tickerRows } = await supabase
    .from("tickers")
    .select("symbol,tier,sector,industry,frame_id")
    .eq("user_id", user.user.id)
    .order("tier");
  const book = (tickerRows ?? []) as Array<{
    symbol: string;
    tier: number;
    sector: string | null;
    industry: string | null;
    frame_id: string | null;
  }>;

  const lines: string[] = [];
  lines.push("USER BOOK:");
  if (book.length === 0) {
    lines.push("  (empty book)");
  } else {
    for (const t of book) {
      lines.push(`  T${t.tier} ${t.symbol}${t.sector ? ` — ${t.sector}` : ""}${t.industry ? ` / ${t.industry}` : ""}`);
    }
  }
  lines.push("");
  lines.push("SECTOR ETF SNAPSHOT (today):");
  for (const r of parsed.data.rows) {
    const flow = r.flowUsd7d != null ? formatUsd(r.flowUsd7d) : "n/a";
    const flowPct = r.flowPct7d != null ? `${r.flowPct7d.toFixed(2)}% of AUM` : "—";
    const ret1w = r.return1W != null ? `${r.return1W >= 0 ? "+" : ""}${r.return1W.toFixed(2)}%` : "—";
    const ret1m = r.return1M != null ? `${r.return1M >= 0 ? "+" : ""}${r.return1M.toFixed(2)}%` : "—";
    const aum = r.aum != null ? formatUsd(r.aum) : "—";
    const bDays = r.baselineDays != null ? `${r.baselineDays}d baseline` : "no baseline yet";
    const frameTag = r.frameLabel ? ` [${r.frameLabel}]` : "";
    lines.push(`  ${r.symbol}${frameTag}: AUM ${aum}, 7d flow ${flow} (${flowPct}, ${bDays}), 1W ${ret1w}, 1M ${ret1m}`);
  }
  lines.push("");
  lines.push("Produce the JSON interpretation now.");

  const completion = await llmComplete({
    purpose: "thesis",
    system: SYSTEM,
    user: lines.join("\n"),
    maxTokens: 1500,
    jsonResponse: true,
  });
  await recordUsage(
    {
      userId: user.user.id,
      model: completion.model,
      endpoint: "etf-flows.interpret",
      usage: completion.usage,
    },
    supabase,
  );

  const raw = parseLenientJson<{
    headline?: string;
    leaders?: string[];
    laggards?: string[];
    bookImplications?: string[];
    watch?: string[];
  }>(completion.text);

  return NextResponse.json({
    headline: raw.headline ?? "",
    leaders: Array.isArray(raw.leaders) ? raw.leaders.map(String).slice(0, 6) : [],
    laggards: Array.isArray(raw.laggards) ? raw.laggards.map(String).slice(0, 6) : [],
    bookImplications: Array.isArray(raw.bookImplications) ? raw.bookImplications.map(String).slice(0, 6) : [],
    watch: Array.isArray(raw.watch) ? raw.watch.map(String).slice(0, 5) : [],
  });
}

function formatUsd(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(0)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}
