// ETF fund flow provider. Scrapes etf.com — likely to be blocked by Cloudflare in
// many environments; falls back to last good DB row. Swap implementation when a paid
// API (e.g. FMP, ETF Database, Tradier) is available.

import { scrapeWithRetry } from "@/lib/providers/scraping";

export interface EtfFlow {
  symbol: string;
  flowUsd: number | null;   // weekly net flow in USD
  aum: number | null;
  fetchedAt: string;
  source: "live" | "stale" | "unavailable";
  fetchedAtSource?: string; // when the live page reported the data
}

export interface EtfFlowsProvider {
  weekly(symbol: string): Promise<EtfFlow>;
}

class EtfDotComProvider implements EtfFlowsProvider {
  async weekly(symbol: string): Promise<EtfFlow> {
    const url = `https://www.etf.com/${symbol}`;
    try {
      const html = await scrapeWithRetry(url, { source: "etf.com", symbol });
      const aum = matchMoneyAfter(html, /AUM\s*<\/[^>]*>\s*<[^>]*>\s*\$?([\d.,]+\s*[BMK]?)/i);
      const flow = matchMoneyAfter(html, /Fund Flows\s*\((1|4|13|26|52)?\s*Week[^)]*\)\s*<\/[^>]*>\s*<[^>]*>\s*\$?(-?[\d.,]+\s*[BMK]?)/i, 2);
      return {
        symbol,
        flowUsd: flow,
        aum,
        fetchedAt: new Date().toISOString(),
        source: "live",
      };
    } catch {
      return {
        symbol,
        flowUsd: null,
        aum: null,
        fetchedAt: new Date().toISOString(),
        source: "unavailable",
      };
    }
  }
}

// Very loose parser — etf.com markup changes often. On miss, returns null and the
// API route serves the last good DB row with a stale badge.
function matchMoneyAfter(html: string, regex: RegExp, group = 1): number | null {
  const m = html.match(regex);
  if (!m || !m[group]) return null;
  const raw = m[group].replace(/[$,\s]/g, "");
  const mult = raw.endsWith("B") ? 1e9 : raw.endsWith("M") ? 1e6 : raw.endsWith("K") ? 1e3 : 1;
  const n = parseFloat(raw);
  if (!Number.isFinite(n)) return null;
  return n * mult;
}

let provider: EtfFlowsProvider | undefined;
export function getEtfFlowsProvider(): EtfFlowsProvider {
  if (!provider) provider = new EtfDotComProvider();
  return provider;
}
