// Analyst estimate revision provider. Phase 1: derive direction from yahoo-finance2
// earningsTrend module (current quarter EPS trend over 7/30/60/90d windows).
// Future: swap with Finviz scrape or paid API (FMP, Refinitiv).
import YahooFinance from "yahoo-finance2";
const yahooFinance: any = new (YahooFinance as any)();

export interface EstimateRevision {
  symbol: string;
  period: string | null;
  currentEstimate: number | null;
  estimate30dAgo: number | null;
  direction: "up" | "down" | "unchanged";
  analystCount: number | null;
  fetchedAt: string;
  source: "live" | "unavailable";
}

export interface EstimateRevisionsProvider {
  fetch(symbol: string): Promise<EstimateRevision>;
}

class YahooEstimateRevisionsProvider implements EstimateRevisionsProvider {
  async fetch(symbol: string): Promise<EstimateRevision> {
    try {
      const summary = await yahooFinance.quoteSummary(symbol, { modules: ["earningsTrend"] });
      const trend: any = summary.earningsTrend ?? {};
      const cq = (trend.trend ?? []).find((t: any) => t.period === "0q") ?? null;
      if (!cq) return blank(symbol);

      const cur = numOrNull(cq.earningsEstimate?.avg);
      const past = numOrNull(cq.epsTrend?.["30daysAgo"]);
      const count = numOrNull(cq.earningsEstimate?.numberOfAnalysts);
      let direction: "up" | "down" | "unchanged" = "unchanged";
      if (cur != null && past != null) {
        if (cur > past * 1.001) direction = "up";
        else if (cur < past * 0.999) direction = "down";
      }

      return {
        symbol,
        period: "0q",
        currentEstimate: cur,
        estimate30dAgo: past,
        direction,
        analystCount: count,
        fetchedAt: new Date().toISOString(),
        source: "live",
      };
    } catch (err) {
      console.error("EstimateRevisions fetch error", symbol, err);
      return blank(symbol);
    }
  }
}

function blank(symbol: string): EstimateRevision {
  return {
    symbol,
    period: null,
    currentEstimate: null,
    estimate30dAgo: null,
    direction: "unchanged",
    analystCount: null,
    fetchedAt: new Date().toISOString(),
    source: "unavailable",
  };
}

function numOrNull(v: any): number | null {
  if (v == null) return null;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "object" && typeof v.raw === "number") return v.raw;
  return null;
}

let provider: EstimateRevisionsProvider | undefined;
export function getEstimateRevisionsProvider(): EstimateRevisionsProvider {
  if (!provider) provider = new YahooEstimateRevisionsProvider();
  return provider;
}
