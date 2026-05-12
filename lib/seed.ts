import type { SupabaseClient } from "@supabase/supabase-js";
import type { TickerTier } from "@/lib/types/db";

interface Seed {
  symbol: string;
  name: string;
  tier: TickerTier;
}

export const SEED_TICKERS: readonly Seed[] = [
  { symbol: "FSLR", name: "First Solar, Inc.", tier: 1 },
  { symbol: "TE",   name: "T1 Energy Inc.",    tier: 1 },
  { symbol: "NXT",  name: "Nextracker Inc.",   tier: 1 },
  { symbol: "ARRY", name: "Array Technologies",tier: 2 },
  { symbol: "CHPT", name: "ChargePoint Holdings", tier: 2 },
  { symbol: "SHLS", name: "Shoals Technologies", tier: 2 },
  { symbol: "ICLN", name: "iShares Global Clean Energy", tier: 3 },
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
