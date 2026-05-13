import YahooFinance from "yahoo-finance2";
const yahooFinance: any = new (YahooFinance as any)();

// Hardcoded for now; moves to Settings tab later.
export const MEGA_CAPS: ReadonlyArray<{ symbol: string; name: string }> = [
  { symbol: "AAPL",  name: "Apple" },
  { symbol: "MSFT",  name: "Microsoft" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "META",  name: "Meta Platforms" },
  { symbol: "AMZN",  name: "Amazon" },
  { symbol: "NVDA",  name: "NVIDIA" },
  { symbol: "TSLA",  name: "Tesla" },
  { symbol: "JPM",   name: "JPMorgan" },
  { symbol: "GS",    name: "Goldman Sachs" },
  { symbol: "BRK-B", name: "Berkshire Hathaway B" },
];

export interface NextEarnings {
  symbol: string;
  earningsDate: string | null;
  timing: "BH" | "AH" | null;
  daysUntil: number | null;
  epsEstimate: number | null;
  revenueEstimate: number | null;
}

export async function getNextEarnings(symbol: string): Promise<NextEarnings> {
  const blank: NextEarnings = {
    symbol,
    earningsDate: null,
    timing: null,
    daysUntil: null,
    epsEstimate: null,
    revenueEstimate: null,
  };
  try {
    const summary = await yahooFinance.quoteSummary(symbol, {
      modules: ["calendarEvents", "earningsTrend"],
    });
    const e = summary?.calendarEvents?.earnings ?? {};
    const dates: unknown[] = e.earningsDate ?? [];
    const now = Date.now();
    const upcoming = dates
      .map((d) => (d instanceof Date ? d : new Date(d as string | number)))
      .filter((d) => !Number.isNaN(d.getTime()) && d.getTime() >= now - 86400000)
      .sort((a, b) => a.getTime() - b.getTime());
    if (upcoming.length === 0) return blank;
    const next = upcoming[0];

    // Yahoo's earningsDate sometimes carries a time component we can read.
    // Hours < 14 UTC → likely BH (pre-market call), >= 20 UTC → AH. Imperfect.
    const hour = next.getUTCHours();
    const timing: "BH" | "AH" | null = hour > 0 && hour < 14 ? "BH" : hour >= 20 ? "AH" : null;

    return {
      symbol,
      earningsDate: next.toISOString().slice(0, 10),
      timing,
      daysUntil: Math.round((next.getTime() - now) / 86400000),
      epsEstimate: numOrNull(e.earningsAverage),
      revenueEstimate: numOrNull(e.revenueAverage),
    };
  } catch (err) {
    console.error("getNextEarnings error", symbol, err);
    return blank;
  }
}

function numOrNull(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object" && v && typeof (v as { raw?: number }).raw === "number") {
    return (v as { raw: number }).raw;
  }
  return null;
}

export async function getNextEarningsBatch(symbols: string[]): Promise<NextEarnings[]> {
  return Promise.all(symbols.map((s) => getNextEarnings(s)));
}
