// Sector ETF data provider. Uses Yahoo's quoteSummary (summaryDetail +
// defaultKeyStatistics + price) to grab AUM, shares outstanding, and spot.
// Fund flow itself is NOT directly available — we infer it server-side by
// comparing today's AUM to a baseline snapshot 7d back and stripping out the
// price-return-explained portion of the AUM change. See /api/etf-flows.

import YahooFinance from "yahoo-finance2";
const yahooFinance: any = new (YahooFinance as any)();

export interface EtfSnapshot {
  symbol: string;
  aum: number | null;                // totalAssets from summaryDetail
  sharesOutstanding: number | null;  // defaultKeyStatistics.sharesOutstanding
  price: number | null;              // regularMarketPrice
  name: string | null;
  fetchedAt: string;
  source: "live" | "unavailable";
}

export interface EtfFlowsProvider {
  snapshot(symbol: string): Promise<EtfSnapshot>;
  snapshotBatch(symbols: string[]): Promise<EtfSnapshot[]>;
}

class YahooEtfProvider implements EtfFlowsProvider {
  async snapshot(symbol: string): Promise<EtfSnapshot> {
    const blank: EtfSnapshot = {
      symbol,
      aum: null,
      sharesOutstanding: null,
      price: null,
      name: null,
      fetchedAt: new Date().toISOString(),
      source: "unavailable",
    };
    try {
      const summary = await yahooFinance.quoteSummary(symbol, {
        modules: ["summaryDetail", "defaultKeyStatistics", "price"],
      });
      const sd = summary?.summaryDetail ?? {};
      const ks = summary?.defaultKeyStatistics ?? {};
      const pr = summary?.price ?? {};

      // Yahoo returns numbers OR objects shaped {raw, fmt}. Normalize.
      const aum = numFrom(sd.totalAssets);
      const sharesOutstanding = numFrom(ks.sharesOutstanding);
      const price = numFrom(pr.regularMarketPrice);
      const name = typeof pr.longName === "string" ? pr.longName : typeof pr.shortName === "string" ? pr.shortName : null;

      if (aum == null && price == null) return blank;

      return {
        symbol,
        aum,
        sharesOutstanding,
        price,
        name,
        fetchedAt: new Date().toISOString(),
        source: "live",
      };
    } catch (err) {
      console.warn("YahooEtfProvider.snapshot error", symbol, err);
      return blank;
    }
  }

  async snapshotBatch(symbols: string[]): Promise<EtfSnapshot[]> {
    return Promise.all(symbols.map((s) => this.snapshot(s)));
  }
}

function numFrom(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (v && typeof v === "object" && "raw" in (v as Record<string, unknown>)) {
    const raw = (v as { raw: unknown }).raw;
    if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  }
  return null;
}

let provider: EtfFlowsProvider | undefined;
export function getEtfFlowsProvider(): EtfFlowsProvider {
  if (!provider) provider = new YahooEtfProvider();
  return provider;
}
