// Position sizing for an earnings trade, following the rules in the spec:
//   - Tier-based max: T1=5%, T2=3%, T3=1% of book
//   - Wide IV move (> ~12%) reduces size by 25% to account for premium being
//     priced in / smaller realized-edge buffer.
//   - Risk gate: a long_stock with `stopPct` distance shouldn't risk more than
//     0.5% of book. If naive sizing breaches that, we scale down.
//   - For options trades, max premium = 30% of position notional.

export type ConvictionTier = 1 | 2 | 3;
export type Structure = "long_stock" | "short_stock" | "long_call" | "long_put" | "long_straddle" | "bull_call_spread" | "bear_put_spread";

export interface SizingInput {
  bookSizeUsd: number;
  tier: ConvictionTier;
  impliedMovePct: number | null;     // ATM straddle implied %
  stopPct: number | null;             // user-defined stop distance, e.g. 8 for 8%
  structure: Structure;
}

export interface SizingOutput {
  positionUsd: number;
  positionPctOfBook: number;
  maxPremiumUsd: number | null;       // for options trades
  effectiveRiskUsd: number;           // expected $ at risk given stop
  effectiveRiskPctOfBook: number;
  notes: string[];                    // human-readable reasoning
}

const TIER_BASE_PCT: Record<ConvictionTier, number> = { 1: 0.05, 2: 0.03, 3: 0.01 };
const HARD_CAP_PCT = 0.05;            // never > 5% in one name
const PER_TRADE_RISK_PCT = 0.005;     // max 0.5% of book at risk per trade
const PREMIUM_MAX_PCT_OF_POSITION = 0.30;

export function computeSizing(input: SizingInput): SizingOutput {
  const notes: string[] = [];
  let pct = TIER_BASE_PCT[input.tier];
  notes.push(`Tier ${input.tier} base sizing: ${(pct * 100).toFixed(1)}% of book.`);

  // Wide IV haircut.
  if (input.impliedMovePct != null && input.impliedMovePct > 12) {
    pct *= 0.75;
    notes.push(`Implied move ${input.impliedMovePct.toFixed(1)}% is wide → 25% size haircut.`);
  }

  // Hard cap.
  if (pct > HARD_CAP_PCT) {
    pct = HARD_CAP_PCT;
    notes.push(`Capped at ${(HARD_CAP_PCT * 100).toFixed(0)}% max per name.`);
  }

  let positionUsd = input.bookSizeUsd * pct;

  // Risk gate (only meaningful for stock / spreads with defined stops).
  const isStockLike = input.structure === "long_stock" || input.structure === "short_stock";
  if (isStockLike && input.stopPct != null && input.stopPct > 0) {
    const naiveRisk = positionUsd * (input.stopPct / 100);
    const maxRisk = input.bookSizeUsd * PER_TRADE_RISK_PCT;
    if (naiveRisk > maxRisk) {
      const scaled = maxRisk / (input.stopPct / 100);
      notes.push(
        `Risk gate: ${input.stopPct}% stop on ${dollars(positionUsd)} = ${dollars(naiveRisk)} risk, above the ${(PER_TRADE_RISK_PCT * 100).toFixed(2)}% / book ceiling. Scaling position down to ${dollars(scaled)}.`,
      );
      positionUsd = scaled;
    }
  }

  // Option premium cap.
  let maxPremiumUsd: number | null = null;
  const isOptions = input.structure !== "long_stock" && input.structure !== "short_stock";
  if (isOptions) {
    maxPremiumUsd = positionUsd * PREMIUM_MAX_PCT_OF_POSITION;
    notes.push(
      `Options trade: max premium spend ${dollars(maxPremiumUsd)} (${(PREMIUM_MAX_PCT_OF_POSITION * 100).toFixed(0)}% of position notional). Anything more = over-paying for premium.`,
    );
  }

  const effectiveRiskUsd = isStockLike && input.stopPct != null && input.stopPct > 0
    ? positionUsd * (input.stopPct / 100)
    : isOptions
    ? maxPremiumUsd ?? 0
    : positionUsd;

  return {
    positionUsd,
    positionPctOfBook: positionUsd / input.bookSizeUsd,
    maxPremiumUsd,
    effectiveRiskUsd,
    effectiveRiskPctOfBook: effectiveRiskUsd / input.bookSizeUsd,
    notes,
  };
}

function dollars(n: number): string {
  return `$${Math.round(n).toLocaleString()}`;
}
