// Short interest provider. yahoo-finance2 quoteSummary returns sharesShort,
// shortRatio, shortPercentOfFloat in defaultKeyStatistics module.
import YahooFinance from "yahoo-finance2";
const yahooFinance: any = new (YahooFinance as any)();

export interface ShortInterest {
  symbol: string;
  siPct: number | null;        // short % of float
  daysToCover: number | null;  // shortRatio
  fetchedAt: string;
  source: "live" | "unavailable";
}

export interface ShortInterestProvider {
  fetch(symbol: string): Promise<ShortInterest>;
}

class YahooShortInterestProvider implements ShortInterestProvider {
  async fetch(symbol: string): Promise<ShortInterest> {
    try {
      const summary = await yahooFinance.quoteSummary(symbol, {
        modules: ["defaultKeyStatistics"],
      });
      const k: any = summary.defaultKeyStatistics ?? {};
      const siRaw = k.shortPercentOfFloat?.raw ?? k.shortPercentOfFloat;
      const dtc = k.shortRatio?.raw ?? k.shortRatio;
      return {
        symbol,
        siPct: typeof siRaw === "number" ? siRaw * 100 : null,
        daysToCover: typeof dtc === "number" ? dtc : null,
        fetchedAt: new Date().toISOString(),
        source: "live",
      };
    } catch (err) {
      console.error("ShortInterest fetch error", symbol, err);
      return { symbol, siPct: null, daysToCover: null, fetchedAt: new Date().toISOString(), source: "unavailable" };
    }
  }
}

let provider: ShortInterestProvider | undefined;
export function getShortInterestProvider(): ShortInterestProvider {
  if (!provider) provider = new YahooShortInterestProvider();
  return provider;
}
