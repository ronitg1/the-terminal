// Starter watchlist seeded on a user's first sign-in if their tickers table
// is empty. EDIT THIS to whatever names you actually trade — the agent's
// industry frames adapt automatically.
//
// Tier convention:
//   1 = core positions (run thesis pipeline 1-2x/day, push on status flips)
//   2 = active monitoring (manual runs, surface in calendar/peers)
//   3 = sector context only (ETFs, benchmarks, peers)

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TickerTier } from "@/lib/types/db";

interface Seed {
  symbol: string;
  name: string;
  tier: TickerTier;
}

// Default starter set spans multiple frames so the multi-agent pipeline
// demonstrates its sector-awareness. Replace freely.
export const SEED_TICKERS: readonly Seed[] = [
  { symbol: "NVDA", name: "NVIDIA",                       tier: 1 },
  { symbol: "JPM",  name: "JPMorgan Chase",               tier: 1 },
  { symbol: "FSLR", name: "First Solar",                  tier: 2 },
  { symbol: "LLY",  name: "Eli Lilly",                    tier: 2 },
  { symbol: "SPY",  name: "SPDR S&P 500 ETF",             tier: 3 },
] as const;

export async function seedTickersIfEmpty(
  supabase: SupabaseClient,
  userId: string,
): Promise<void> {
  const { count, error: countErr } = await supabase
    .from("tickers")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  if (countErr) {
    console.error("seedTickersIfEmpty count error", countErr);
    return;
  }
  if ((count ?? 0) > 0) return;

  const rows = SEED_TICKERS.map((t) => ({
    user_id: userId,
    symbol: t.symbol,
    name: t.name,
    tier: t.tier,
    notes: "",
  }));

  const { error } = await supabase.from("tickers").insert(rows);
  if (error) console.error("seedTickersIfEmpty insert error", error);
}
