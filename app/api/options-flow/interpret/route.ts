// AI interpretation of a ticker's options flow. Sends the chain summary +
// notable contracts + earnings context + current thesis status to the LLM and
// asks for a structured read: directional bias, who's buying, whether the
// flow confirms or contradicts the user's thesis, and what to watch.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { llmComplete } from "@/lib/llm";
import { getOptionsProvider } from "@/lib/providers/options";
import { getNextEarnings } from "@/lib/providers/earnings-calendar";
import { parseLenientJson } from "@/lib/agent/jsonRepair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  symbol: z.string().min(1).max(12).transform((s) => s.toUpperCase()),
  expiry: z.string().optional(),       // optional expiry override
});

const SYSTEM = `You are an options strategist for a discretionary investor. You see chain aggregates from Yahoo (front-of-book or earnings expiry). You do NOT see institutional unusual-activity tape, so treat volume/OI ratios as a noisy signal — calibrate confidence accordingly.

Output JSON ONLY — no prose, no fences:
{
  "bias": "bullish" | "bearish" | "mixed" | "neutral",
  "confidence": "low" | "medium" | "high",
  "headline": "1-sentence read of what the flow is saying",
  "evidence": ["3-5 bullets citing specific numbers from the data: C/P ratios, notional skew, ATM IV, notable strikes"],
  "thesisAlignment": "confirms" | "contradicts" | "neutral" | "n/a",
  "thesisAlignmentReason": "1 sentence — leave empty string if n/a",
  "watch": ["2-3 bullets: specific things to monitor in this name's flow over the next few sessions"]
}

Be specific. Cite numbers. Skip generic disclaimers. If the data is too thin (low volume across the board) say so in headline and downgrade confidence.`;

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

  const { symbol, expiry } = parsed.data;
  const provider = getOptionsProvider();

  const [summary, earnings, latestThesis] = await Promise.all([
    provider.chainSummary(symbol, expiry),
    getNextEarnings(symbol).catch(() => null),
    supabase
      .from("thesis_snapshots")
      .select("content,conviction,status,generated_at,data")
      .eq("user_id", user.user.id)
      .eq("symbol", symbol)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (!summary) {
    return NextResponse.json({ error: `No options chain available for ${symbol}` }, { status: 404 });
  }

  const thesisRow = latestThesis.data as
    | { content: string; conviction: number | null; status: string | null; generated_at: string }
    | null;

  const totalVol = summary.callVolume + summary.putVolume;
  const totalNotional = summary.callNotionalUsd + summary.putNotionalUsd;

  const lines: string[] = [];
  lines.push(`SYMBOL: ${symbol}`);
  lines.push(`SPOT: ${summary.spot ?? "n/a"}`);
  lines.push(`EXPIRY: ${summary.expiry} (${summary.daysToExpiry}d)`);
  if (earnings?.earningsDate) {
    lines.push(`NEXT EARNINGS: ${earnings.earningsDate} (${earnings.daysUntil}d, ${earnings.timing ?? "?"})`);
  } else {
    lines.push("NEXT EARNINGS: none scheduled");
  }
  lines.push("");
  lines.push("CHAIN AGGREGATE (this expiry):");
  lines.push(`  Call volume: ${summary.callVolume.toLocaleString()}`);
  lines.push(`  Put volume:  ${summary.putVolume.toLocaleString()}`);
  lines.push(`  Total volume: ${totalVol.toLocaleString()}`);
  lines.push(`  C/P vol ratio: ${summary.callPutVolumeRatio?.toFixed(2) ?? "n/a"}`);
  lines.push(`  Call OI: ${summary.callOpenInterest.toLocaleString()}`);
  lines.push(`  Put OI:  ${summary.putOpenInterest.toLocaleString()}`);
  lines.push(`  C/P OI ratio: ${summary.callPutOiRatio?.toFixed(2) ?? "n/a"}`);
  lines.push(`  Call notional: $${Math.round(summary.callNotionalUsd).toLocaleString()}`);
  lines.push(`  Put notional:  $${Math.round(summary.putNotionalUsd).toLocaleString()}`);
  lines.push(`  Total notional: $${Math.round(totalNotional).toLocaleString()}`);
  lines.push(`  ATM IV: ${summary.atmIv != null ? (summary.atmIv * 100).toFixed(1) + "%" : "n/a"}`);
  lines.push("");
  lines.push("NOTABLE CONTRACTS (top by volume/OI ratio):");
  if (summary.notableContracts.length === 0) {
    lines.push("  (none — sub-50 contract volume across the chain)");
  } else {
    for (const c of summary.notableContracts) {
      lines.push(
        `  ${c.type.toUpperCase()} ${c.strike} exp ${c.expiry} (${c.daysToExpiry}d) — vol ${c.volume.toLocaleString()} / OI ${c.openInterest.toLocaleString()} = ${c.volOiRatio.toFixed(2)}x, IV ${c.impliedVolatility != null ? (c.impliedVolatility * 100).toFixed(0) + "%" : "n/a"}, notional ${c.notionalUsd != null ? "$" + Math.round(c.notionalUsd).toLocaleString() : "n/a"}`,
      );
    }
  }

  if (thesisRow) {
    lines.push("");
    lines.push("CURRENT THESIS:");
    lines.push(`  Status: ${thesisRow.status ?? "n/a"}, Conviction: ${thesisRow.conviction ?? "n/a"}/10`);
    if (thesisRow.content) {
      lines.push(`  Last note: ${thesisRow.content.slice(0, 600)}${thesisRow.content.length > 600 ? "…" : ""}`);
    }
  }

  lines.push("");
  lines.push("Produce the JSON interpretation now.");

  try {
    const completion = await llmComplete({
      purpose: "thesis",
      system: SYSTEM,
      user: lines.join("\n"),
      maxTokens: 900,
      jsonResponse: true,
    });
    await recordUsage(
      {
        userId: user.user.id,
        model: completion.model,
        endpoint: "options-flow.interpret",
        usage: completion.usage,
      },
      supabase,
    );
    const out = parseLenientJson<{
      bias?: "bullish" | "bearish" | "mixed" | "neutral";
      confidence?: "low" | "medium" | "high";
      headline?: string;
      evidence?: string[];
      thesisAlignment?: "confirms" | "contradicts" | "neutral" | "n/a";
      thesisAlignmentReason?: string;
      watch?: string[];
    }>(completion.text);
    return NextResponse.json({
      bias: out.bias ?? "neutral",
      confidence: out.confidence ?? "low",
      headline: out.headline ?? "",
      evidence: Array.isArray(out.evidence) ? out.evidence.map(String).slice(0, 6) : [],
      thesisAlignment: out.thesisAlignment ?? "n/a",
      thesisAlignmentReason: out.thesisAlignmentReason ?? "",
      watch: Array.isArray(out.watch) ? out.watch.map(String).slice(0, 5) : [],
      summary,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
