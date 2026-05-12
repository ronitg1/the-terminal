import { NextResponse, type NextRequest } from "next/server";
import { llmComplete } from "@/lib/llm";
import { createServerSupabase } from "@/lib/supabase/server";
import { getOptionsProvider, type ContractsForExpiry } from "@/lib/providers/options";
import { getNextEarnings } from "@/lib/providers/earnings-calendar";
import { getQuotesProvider } from "@/lib/providers/quotes";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { parseLenientJson } from "@/lib/agent/jsonRepair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TRADE_SYSTEM = `You are an energy-transition equity analyst building the single best earnings setup for a sophisticated investor.

You are given:
- Today's date (in the user message; DO NOT use your training-data calendar).
- The next-earnings date for each T1 ticker (use this, not your priors).
- Each ticker's thesis snapshot, implied move, short interest, and a snapshot of the option chain (ATM call / put bid-ask) covering its next earnings.

Pick the SINGLE highest-conviction earnings setup right now and produce a CONCRETE, executable trade plan.

CRITICAL RULES:
- Recommend specific contracts or shares. Vague guidance like "monthly expiry covering report date" is forbidden.
- Use the actual data provided (next earnings date, available expiries, ATM strikes). Do NOT make up dates or strikes.
- Choose ONE of: options trade (1+ contracts) OR stock trade (long or short shares).
- For options, every contract must have: side (buy/sell), type (call/put), exact strike, exact expiry (must match a listed expiry), quantity.
- For stock, specify direction (long/short) and approximate share count (assume $200K book unless stated).
- Reference the actual next-earnings date in your rationale (e.g. "ahead of the Aug 5 print").

Output JSON ONLY — no prose, no markdown fences. Schema:

{
  "symbol": "FSLR",
  "rationale": "2-4 sentences. Reference the actual next earnings date and the specific catalyst.",
  "structure": "long_straddle" | "long_call" | "long_put" | "bull_call_spread" | "bear_put_spread" | "long_stock" | "short_stock",
  "tradeDetails": {
    "type": "options" | "stock",
    "expiry": "YYYY-MM-DD" | null,
    "contracts": [
      { "side": "buy" | "sell", "type": "call" | "put", "strike": 235, "expiry": "2026-08-15", "quantity": 2, "estimatedDebit": 23.50 }
    ] | null,
    "shares": null | { "direction": "long" | "short", "quantity": 200, "notional": 47000 },
    "estimatedCostUsd": 4700
  },
  "sizing": "string explaining % of book and dollar allocation, assuming a $200K book",
  "risks": ["string", "string"],
  "exitPlan": {
    "trimOnBeat": "specific level / % move that triggers the trim",
    "stopOnMiss": "specific level / % move that triggers the stop"
  }
}`;

const ASSUMED_BOOK_USD = 200_000;

export async function POST(_req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: tickers } = await supabase
    .from("tickers")
    .select("symbol,name,tier")
    .eq("user_id", user.user.id)
    .eq("tier", 1);

  if (!tickers || tickers.length === 0) {
    return NextResponse.json({ error: "No T1 tickers in your book." }, { status: 400 });
  }

  try {
    await ensureBudget(supabase, user.user.id);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message, month: err.month }, { status: 402 });
    }
    throw err;
  }

  const symbols = tickers.map((t) => t.symbol as string);

  const optionsProvider = getOptionsProvider();
  const quotesProvider = getQuotesProvider();

  const perTicker = await Promise.all(
    symbols.map(async (sym) => {
      const [quoteArr, earnings, expiries] = await Promise.all([
        quotesProvider.batchQuotes([sym]),
        getNextEarnings(sym),
        optionsProvider.expiries(sym),
      ]);
      const quote = quoteArr[0] ?? null;
      const earningsDate = earnings.earningsDate;
      const targetExpiry =
        earningsDate && expiries.length > 0
          ? expiries.find((e) => e >= earningsDate) ?? expiries[0]
          : expiries[0] ?? null;
      const contracts: ContractsForExpiry | null = targetExpiry
        ? await optionsProvider.contractsForExpiry(sym, targetExpiry)
        : null;
      return { sym, quote, earnings, expiries: expiries.slice(0, 8), contracts };
    }),
  );

  const { data: theses } = await supabase
    .from("thesis_snapshots")
    .select("symbol,status,conviction,content,generated_at")
    .eq("user_id", user.user.id)
    .in("symbol", symbols)
    .order("generated_at", { ascending: false });

  const latestPerSym = new Map<string, { status: string; conviction: number | null; content: string }>();
  for (const t of theses ?? []) {
    if (!latestPerSym.has(t.symbol)) latestPerSym.set(t.symbol, t as any);
  }

  const block = perTicker
    .map(({ sym, quote, earnings, expiries, contracts }) => {
      const t = tickers.find((x) => x.symbol === sym);
      const th = latestPerSym.get(sym);
      const lines = [
        `### ${sym}${t?.name ? ` (${t.name})` : ""}`,
        `Spot: ${quote?.price != null ? `$${quote.price.toFixed(2)}` : "n/a"}`,
        `Next earnings: ${earnings.earningsDate ?? "unknown"}${earnings.daysUntil != null ? ` (${earnings.daysUntil} days away)` : ""}`,
        th ? `Thesis status: ${th.status} · conviction ${th.conviction ?? "—"}/10` : `Thesis: (no snapshot yet)`,
        th?.content ? `Thesis body: ${th.content}` : "",
        `Available expiries: ${expiries.join(", ") || "none"}`,
      ];
      if (contracts) {
        const fmtQuote = (c: { strike: number; bid: number | null; ask: number | null; mid: number | null }) =>
          `${c.strike} (bid ${c.bid?.toFixed(2) ?? "—"} / ask ${c.ask?.toFixed(2) ?? "—"} / mid ${c.mid?.toFixed(2) ?? "—"})`;
        lines.push(
          `Option chain covering earnings — expiry ${contracts.expiry} (${contracts.daysToExpiry} DTE):`,
          `  ATM strike: ${contracts.atmStrike}`,
          contracts.atmCall ? `  ATM call: ${fmtQuote(contracts.atmCall)}` : "",
          contracts.atmPut ? `  ATM put: ${fmtQuote(contracts.atmPut)}` : "",
          contracts.callsNearAtm.length > 0
            ? `  Nearby calls: ${contracts.callsNearAtm.map((c) => fmtQuote(c)).join(", ")}`
            : "",
          contracts.putsNearAtm.length > 0
            ? `  Nearby puts: ${contracts.putsNearAtm.map((c) => fmtQuote(c)).join(", ")}`
            : "",
        );
      } else {
        lines.push("Option chain: unavailable");
      }
      return lines.filter(Boolean).join("\n");
    })
    .join("\n\n");

  const today = new Date().toISOString().slice(0, 10);
  const userPrompt = `TODAY: ${today}\nASSUMED BOOK SIZE: $${ASSUMED_BOOK_USD.toLocaleString()}\n\nT1 BOOK SNAPSHOT:\n\n${block}\n\nProduce the JSON trade idea now. Pick from the listed expiries and strikes only — do NOT invent values.`;

  const completion = await llmComplete({
    purpose: "trade-idea",
    system: TRADE_SYSTEM,
    user: userPrompt,
    maxTokens: 3500,
    jsonResponse: true,
  });

  await recordUsage(
    {
      userId: user.user.id,
      model: completion.model,
      endpoint: "agent.trade_idea",
      usage: completion.usage,
    },
    supabase,
  );

  const raw = completion.text;
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = parseLenientJson<Record<string, unknown>>(raw);
  } catch (err) {
    console.error("[trade-idea] lenient JSON parse failed. Raw tail:", raw.slice(-600), "err:", err);
  }

  let savedId: string | null = null;
  if (parsed && typeof parsed.symbol === "string") {
    const exitPlan = (parsed.exitPlan ?? {}) as { trimOnBeat?: string; stopOnMiss?: string };
    const { data: inserted, error: insertErr } = await supabase
      .from("trade_ideas")
      .insert({
        user_id: user.user.id,
        symbol: String(parsed.symbol).toUpperCase(),
        rationale: typeof parsed.rationale === "string" ? parsed.rationale : null,
        structure: typeof parsed.structure === "string" ? parsed.structure : null,
        strike_guidance: null,
        sizing: typeof parsed.sizing === "string" ? parsed.sizing : null,
        risks: Array.isArray(parsed.risks) ? parsed.risks : [],
        trim_on_beat: typeof exitPlan.trimOnBeat === "string" ? exitPlan.trimOnBeat : null,
        stop_on_miss: typeof exitPlan.stopOnMiss === "string" ? exitPlan.stopOnMiss : null,
        raw: parsed,
      })
      .select("id")
      .single();
    if (insertErr) console.error("trade_ideas insert failed", insertErr);
    else savedId = inserted?.id ?? null;
  }

  return NextResponse.json({ tradeIdea: parsed ?? null, savedId, raw });
}
