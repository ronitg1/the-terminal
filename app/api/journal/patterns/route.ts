// Pattern analysis on the user's recent journal entries + tracked AI trade
// ideas. Asks the LLM to surface recurring habits, mistakes, and emotional
// patterns. On-demand (not stored — regenerate freely).

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { llmComplete } from "@/lib/llm";
import { parseLenientJson } from "@/lib/agent/jsonRepair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const MIN_TRADES = 5;          // soft threshold — surfaced in the response, not enforced
const MAX_JOURNAL_ENTRIES = 60;
const MAX_TRADES = 60;

const SYSTEM = `You are an experienced trading coach reviewing a discretionary energy-transition fund PM's recent journal entries and AI-generated trade ideas they tracked. The PM trades equities, options spreads, and occasionally outright options.

Your job: surface PATTERNS, not one-off observations. You're looking for repeated habits — both productive ones to keep and counterproductive ones to fix.

Output JSON ONLY — no prose, no fences:
{
  "headline": "1-sentence top-line read on the PM's behavior over this window",
  "strengths": ["3-5 bullets — concrete, evidence-cited patterns that are working"],
  "mistakes": [
    { "pattern": "1 sentence describing the mistake pattern", "evidence": "specific example(s) from the data, with ticker/date if possible", "fix": "1 concrete change to make next time" }
  ],
  "byTier": "1 paragraph: any tier-specific patterns (e.g. 'T2 names get sized like T1, leading to outsized drawdowns')",
  "byStructure": "1 paragraph: patterns by trade structure (stock vs spreads vs outright options)",
  "byHoldingPeriod": "1 paragraph: patterns by holding period (do day trades work? do swings outperform position trades?)",
  "emotional": "1 paragraph: emotional or process tells (e.g. 'revenge sizing after a loss', 'risk-off mode after a tough Monday')",
  "watchlist": ["3-5 specific things to track over the next 4 weeks to confirm or kill these patterns"]
}

Rules:
- Be SPECIFIC. Cite tickers, dates, percent moves, or trade structures from the data.
- Mistakes get the most space — the PM is paying for coaching, not a pat on the back.
- Skip generic platitudes (no 'discipline matters', no 'cut losses short'). Every bullet must reference this PM's actual behavior.
- If data is thin (fewer than ~5 closed trades), say so in headline and keep mistake/byTier/byStructure sections short.`;

interface OutputShape {
  headline?: string;
  strengths?: string[];
  mistakes?: Array<{ pattern?: string; evidence?: string; fix?: string }>;
  byTier?: string;
  byStructure?: string;
  byHoldingPeriod?: string;
  emotional?: string;
  watchlist?: string[];
}

export async function POST(_req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  try {
    await ensureBudget(supabase, user.user.id);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message, month: err.month }, { status: 402 });
    }
    throw err;
  }

  // Pull last 90 days of journal entries + last 90 days of trade ideas (open & closed)
  const cutoff = new Date(Date.now() - 90 * 86400_000).toISOString().slice(0, 10);
  const [{ data: journalRows }, { data: tradeRows }] = await Promise.all([
    supabase
      .from("journal_entries")
      .select("date,content,tags")
      .eq("user_id", user.user.id)
      .gte("date", cutoff)
      .order("date", { ascending: false })
      .limit(MAX_JOURNAL_ENTRIES),
    supabase
      .from("trade_ideas")
      .select("symbol,direction,structure,rationale,entry_spot_price,tracked_at,closed_spot_price,closed_at,created_at,is_tracked")
      .eq("user_id", user.user.id)
      .order("created_at", { ascending: false })
      .limit(MAX_TRADES),
  ]);

  const journal = (journalRows ?? []) as Array<{ date: string; content: string; tags: string[] | null }>;
  const trades = (tradeRows ?? []) as Array<{
    symbol: string;
    direction: string | null;
    structure: string | null;
    rationale: string | null;
    entry_spot_price: number | null;
    tracked_at: string | null;
    closed_spot_price: number | null;
    closed_at: string | null;
    created_at: string;
    is_tracked: boolean | null;
  }>;

  if (journal.length === 0 && trades.length === 0) {
    return NextResponse.json(
      { error: "Not enough data — log a few journal entries or track some trade ideas first." },
      { status: 400 },
    );
  }

  // Build a compact data dump.
  const lines: string[] = [];
  lines.push(`WINDOW: last 90 days (since ${cutoff})`);
  lines.push(`JOURNAL ENTRIES: ${journal.length}`);
  lines.push(`TRADE IDEAS: ${trades.length} (tracked: ${trades.filter((t) => t.is_tracked).length}, closed: ${trades.filter((t) => t.closed_at).length})`);
  if (trades.filter((t) => t.closed_at).length < MIN_TRADES) {
    lines.push(`NOTE: fewer than ${MIN_TRADES} closed trades — pattern analysis will be tentative.`);
  }
  lines.push("");
  lines.push("=== TRADE IDEAS ===");
  for (const t of trades) {
    const entry = t.entry_spot_price ?? null;
    const exit = t.closed_spot_price ?? null;
    let pnlPct: number | null = null;
    if (entry != null && exit != null && entry > 0) {
      const raw = ((exit / entry) - 1) * 100;
      pnlPct = t.direction === "short" || t.direction === "bearish" ? -raw : raw;
    }
    const heldDays =
      t.tracked_at && t.closed_at
        ? Math.round((new Date(t.closed_at).getTime() - new Date(t.tracked_at).getTime()) / 86400_000)
        : null;
    lines.push(
      `  ${t.symbol} ${t.direction ?? "?"} ${t.structure ?? "?"} — entry ${entry ?? "?"} / exit ${exit ?? "open"} / pnl ${
        pnlPct != null ? (pnlPct >= 0 ? "+" : "") + pnlPct.toFixed(1) + "%" : "open"
      } / held ${heldDays != null ? heldDays + "d" : "open"} / tracked=${t.is_tracked ? "Y" : "N"}`,
    );
    if (t.rationale) lines.push(`    rationale: ${t.rationale.slice(0, 280)}`);
  }
  lines.push("");
  lines.push("=== JOURNAL ENTRIES (most recent first) ===");
  for (const j of journal) {
    const tags = j.tags && j.tags.length > 0 ? ` [${j.tags.join(",")}]` : "";
    lines.push(`  ${j.date}${tags}:`);
    lines.push(`    ${j.content.slice(0, 800).replace(/\s+/g, " ").trim()}`);
  }
  lines.push("");
  lines.push("Produce the JSON pattern analysis now.");

  const completion = await llmComplete({
    purpose: "thesis",
    system: SYSTEM,
    user: lines.join("\n"),
    maxTokens: 2200,
    jsonResponse: true,
  });

  await recordUsage(
    {
      userId: user.user.id,
      model: completion.model,
      endpoint: "journal.patterns",
      usage: completion.usage,
    },
    supabase,
  );

  const raw = parseLenientJson<OutputShape>(completion.text);
  const out = {
    headline: raw.headline ?? "",
    strengths: Array.isArray(raw.strengths) ? raw.strengths.map(String).slice(0, 8) : [],
    mistakes: Array.isArray(raw.mistakes)
      ? raw.mistakes
          .filter((m) => m && (m.pattern || m.evidence))
          .map((m) => ({
            pattern: String(m.pattern ?? "").trim(),
            evidence: String(m.evidence ?? "").trim(),
            fix: String(m.fix ?? "").trim(),
          }))
          .slice(0, 8)
      : [],
    byTier: raw.byTier ?? "",
    byStructure: raw.byStructure ?? "",
    byHoldingPeriod: raw.byHoldingPeriod ?? "",
    emotional: raw.emotional ?? "",
    watchlist: Array.isArray(raw.watchlist) ? raw.watchlist.map(String).slice(0, 8) : [],
    counts: {
      journal: journal.length,
      trades: trades.length,
      closedTrades: trades.filter((t) => t.closed_at).length,
    },
  };

  return NextResponse.json(out);
}
