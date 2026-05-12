// yahoo-finance2 v3.x default export is the YahooFinance class — instantiate once.
import YahooFinance from "yahoo-finance2";
const yahooFinance: any = new (YahooFinance as any)();

export interface QuoteSnapshot {
  symbol: string;
  name: string | null;
  price: number | null;
  changePct: number | null;
  prevClose: number | null;
  high52w: number | null;
  low52w: number | null;
  fetchedAt: string;
}

export interface QuotesProvider {
  batchQuotes(symbols: string[]): Promise<QuoteSnapshot[]>;
  search(query: string): Promise<Array<{ symbol: string; name: string; type: string | null }>>;
  history(symbol: string, period: "1mo" | "3mo" | "6mo" | "1y" | "2y"): Promise<Array<{ date: string; close: number }>>;
}

const PERIOD_DAYS: Record<string, number> = { "1mo": 31, "3mo": 95, "6mo": 190, "1y": 370, "2y": 740 };

class YahooQuotesProvider implements QuotesProvider {
  async batchQuotes(symbols: string[]): Promise<QuoteSnapshot[]> {
    if (symbols.length === 0) return [];
    try {
      // yahoo-finance2.quote accepts an array; returns an array.
      const raw = await yahooFinance.quote(symbols, {}, { validateResult: false });
      const arr = Array.isArray(raw) ? raw : [raw];
      return arr.map((q: any) => ({
        symbol: q.symbol,
        name: q.shortName ?? q.longName ?? null,
        price: q.regularMarketPrice ?? null,
        changePct: q.regularMarketChangePercent ?? null,
        prevClose: q.regularMarketPreviousClose ?? null,
        high52w: q.fiftyTwoWeekHigh ?? null,
        low52w: q.fiftyTwoWeekLow ?? null,
        fetchedAt: new Date().toISOString(),
      }));
    } catch (err) {
      console.error("YahooQuotesProvider.batchQuotes error", err);
      return symbols.map((s) => ({
        symbol: s,
        name: null,
        price: null,
        changePct: null,
        prevClose: null,
        high52w: null,
        low52w: null,
        fetchedAt: new Date().toISOString(),
      }));
    }
  }

  async search(query: string): Promise<Array<{ symbol: string; name: string; type: string | null }>> {
    if (!query.trim()) return [];
    try {
      const res = await yahooFinance.search(query, { quotesCount: 8, newsCount: 0 });
      return (res.quotes ?? [])
        .filter((q: any) => q.symbol)
        .map((q: any) => ({
          symbol: q.symbol,
          name: q.shortname ?? q.longname ?? q.symbol,
          type: q.quoteType ?? null,
        }));
    } catch (err) {
      console.error("YahooQuotesProvider.search error", err);
      return [];
    }
  }

  async history(symbol: string, period: keyof typeof PERIOD_DAYS): Promise<Array<{ date: string; close: number }>> {
    const days = PERIOD_DAYS[period];
    const period1 = new Date(Date.now() - days * 86400 * 1000);
    try {
      const rows = await yahooFinance.chart(symbol, { period1, interval: "1d" });
      const quotes = rows.quotes ?? [];
      return quotes
        .filter((r: any) => r.close != null && r.date)
        .map((r: any) => ({
          date: (r.date instanceof Date ? r.date : new Date(r.date)).toISOString().slice(0, 10),
          close: r.close,
        }));
    } catch (err) {
      console.error("YahooQuotesProvider.history error", symbol, err);
      return [];
    }
  }
}

let provider: QuotesProvider | undefined;
export function getQuotesProvider(): QuotesProvider {
  if (!provider) provider = new YahooQuotesProvider();
  return provider;
}
