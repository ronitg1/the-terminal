import { NextResponse, type NextRequest } from "next/server";
import { llmComplete } from "@/lib/llm";
import { createServerSupabase } from "@/lib/supabase/server";
import { getOptionsProvider, type ContractsForExpiry } from "@/lib/providers/options";
import { getNextEarnings } from "@/lib/providers/earnings-calendar";
import { getQuotesProvider } from "@/lib/providers/quotes";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { parseLenientJson } from "@/lib/agent/jsonRepair";
import { getUserSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const TRADE_SYSTEM = `You are a discretionary fund analyst building the single best near-term setup for a sophisticated investor. The reader will execute this exact trade in their brokerage — every number must be precise enough to enter directly.

You are given:
- Today's date (in the user message; DO NOT use your training-data calendar).
- The user's BOOK SIZE in dollars (in the user message). Size against this.
- The next-earnings date for each T1 ticker (use this, not your priors).
- Each ticker's thesis snapshot, implied move, short interest, and the option chain (ATM call / put bid-ask + nearby strikes) covering the earnings expiry.

Pick the SINGLE highest-conviction setup right now and produce a CONCRETE, executable trade plan.

CRITICAL RULES:
- Recommend specific contracts or shares. Vague guidance like "monthly expiry" is forbidden.
- Use the actual data provided (next earnings date, available expiries, ATM strikes). Do NOT invent dates or strikes.
- Choose ONE of: options trade (1+ contracts) OR stock trade (long or short shares).
- For options: every contract has side (buy/sell), type (call/put), exact strike, exact expiry (must match a listed expiry), quantity, and the model's best estimate of mid-price debit/credit per contract.
- For stock: direction (long/short), share count, current spot, and total notional in dollars.
- Risk sizing: the position's MAX LOSS in USD must be approximately 0.5%–2% of BOOK SIZE for a single name. Stay inside that band. If you can't fit the trade inside 2%, reduce contracts/shares.
- Reference the actual next-earnings date in your rationale (e.g. "ahead of the Aug 5 print").

Output JSON ONLY — no prose, no markdown fences. Schema:

{
  "symbol": "FSLR",
  "rationale": "2-4 sentences. Reference the actual next earnings date and the specific catalyst.",
  "structure": "long_straddle" | "long_call" | "long_put" | "bull_call_spread" | "bear_put_spread" | "long_stock" | "short_stock",
  "directionalBias": "bullish" | "bearish" | "neutral_vol",
  "tradeDetails": {
    "type": "options" | "stock",
    "expiry": "YYYY-MM-DD" | null,
    "contracts": [
      { "side": "buy" | "sell", "type": "call" | "put", "strike": 235, "expiry": "2026-08-15", "quantity": 2, "estimatedDebit": 23.50 }
    ] | null,
    "shares": null | { "direction": "long" | "short", "quantity": 200, "spotPrice": 235.00, "notional": 47000 },
    "estimatedCostUsd": 4700
  },
  "sizing": {
    "capitalAtRiskUsd": 4700,
    "maxLossUsd": 4700,
    "pctOfBook": 2.35,
    "narrative": "1-2 sentences explaining the size and risk relative to BOOK SIZE."
  },
  "riskReward": {
    "targetGainUsd": 9400,
    "rMultiple": 2.0,
    "narrative": "1 sentence: what gives this trade its R:R (move expected vs cost)."
  },
  "entryPlan": {
    "trigger": "now" | "if/then condition (e.g. 'on a pullback to $220 support')",
    "limitPrice": 23.50,
    "validUntil": "YYYY-MM-DD or 'end of day'"
  },
  "exitPlan": {
    "priceTargetUp": 280,
    "priceTargetDown": 200,
    "trimOnBeat": "specific level / % move that triggers the partial trim",
    "stopOnMiss": "specific level / % move that triggers the stop",
    "timeStop": "exit date if catalyst hasn't played out (e.g. 'close by 2026-09-01 if no breakout')"
  },
  "expectedHoldingDays": 14,
  "successProbability": 6,
  "risks": ["string", "string"]
}

Rules on the numbers:
- maxLossUsd: for long options/spreads = estimatedCostUsd. For stock with a hard stop, = shares * abs(spot - stopPrice). Always provide a finite number.
- pctOfBook: capitalAtRiskUsd / BOOK_SIZE * 100, to 2 decimals.
- rMultiple: targetGainUsd / maxLossUsd. Aim for ≥1.5 (skip the trade otherwise — say so in rationale).
- successProbability: integer 1-10. ≥6 means you'd put it on at this size.`;

const DEFAULT_BOOK_USD = 200_000;

export async function POST(_req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const [{ data: tickers }, settings] = await Promise.all([
    supabase
      .from("tickers")
      .select("symbol,name,tier")
      .eq("user_id", user.user.id)
      .eq("tier", 1),
    getUserSettings(supabase, user.user.id),
  ]);

  if (!tickers || tickers.length === 0) {
    return NextResponse.json({ error: "No T1 tickers in your book." }, { status: 400 });
  }

  const bookSizeUsd = settings.bookSizeUsd ?? DEFAULT_BOOK_USD;

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
  const maxLossDollar = Math.round(bookSizeUsd * 0.02);
  const userPrompt = `TODAY: ${today}
BOOK SIZE: $${bookSizeUsd.toLocaleString()}
RISK BUDGET: Single-name max loss ${(0.5).toFixed(1)}%–${(2).toFixed(1)}% of book = $${Math.round(bookSizeUsd * 0.005).toLocaleString()}–$${maxLossDollar.toLocaleString()}.

T1 BOOK SNAPSHOT:

${block}

Produce the JSON trade idea now. Size against the BOOK SIZE above. Pick from the listed expiries and strikes only — do NOT invent values. Every dollar figure in the output (capitalAtRiskUsd, maxLossUsd, targetGainUsd, notional, etc.) must be a real number consistent with the contracts/shares specified.`;

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
