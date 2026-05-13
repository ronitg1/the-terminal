// News provider with a layered strategy:
//   - For PER-TICKER news (forSymbol): prefer Finnhub's /company-news endpoint
//     which returns articles actually tagged to that ticker. Free tier = 60/min.
//   - If Finnhub isn't configured OR returns no results, fall back to NewsAPI
//     with STRICT TITLE FILTERING (title must contain the ticker or the
//     company name) so we don't surface sector roundups.
//   - For free-form macro/sector SEARCH: use NewsAPI as-is (broad query is the
//     point).

import { finnhubCompanyNews } from "@/lib/providers/finnhub";

export interface NewsHeadline {
  title: string;
  description: string | null;
  source: string | null;
  url: string;
  publishedAt: string;
}

interface NewsApiResponse {
  status: string;
  articles?: Array<{
    title: string;
    description: string | null;
    source: { name: string | null };
    url: string;
    publishedAt: string;
  }>;
  message?: string;
}

export interface NewsProvider {
  forSymbol(symbol: string, hoursBack?: number): Promise<NewsHeadline[]>;
  search(query: string, hoursBack?: number): Promise<NewsHeadline[]>;
}

class HybridNewsProvider implements NewsProvider {
  async forSymbol(symbol: string, hoursBack = 48): Promise<NewsHeadline[]> {
    // 1. Finnhub (preferred) — articles are pre-tagged by ticker.
    const finn = await finnhubCompanyNews(symbol, { hoursBack });
    if (finn.length > 0) {
      return finn
        .map((a) => ({
          title: a.headline,
          description: a.summary || null,
          source: a.source || null,
          url: a.url,
          publishedAt: new Date(a.datetime * 1000).toISOString(),
        }))
        .filter((a) => a.title && a.url);
    }

    // 2. NewsAPI fallback with strict title filtering.
    const name = nameHintFor(symbol);
    const candidates = await this.search(`"${symbol}" OR "${name}"`, hoursBack);
    const sym = symbol.toUpperCase();
    const nameLower = name.toLowerCase();
    return candidates.filter((a) => {
      const t = (a.title ?? "").toLowerCase();
      const d = (a.description ?? "").toLowerCase();
      // Title must mention the ticker (as a word) OR the company name.
      const hasTickerInTitle = new RegExp(`\\b${sym}\\b`).test(t.toUpperCase());
      const hasNameInTitle = nameLower.length >= 4 && t.includes(nameLower);
      const hasNameInDesc = nameLower.length >= 4 && d.includes(nameLower);
      return hasTickerInTitle || hasNameInTitle || hasNameInDesc;
    });
  }

  async search(query: string, hoursBack = 48): Promise<NewsHeadline[]> {
    const key = process.env.NEWS_API_KEY?.trim();
    if (!key) return [];

    const from = new Date(Date.now() - hoursBack * 3600 * 1000).toISOString();
    const params = new URLSearchParams({
      q: query,
      from,
      language: "en",
      sortBy: "publishedAt",
      pageSize: "20",
      apiKey: key,
    });

    try {
      const res = await fetch(`https://newsapi.org/v2/everything?${params}`, {
        cache: "no-store",
      });
      if (!res.ok) {
        if (process.env.NODE_ENV !== "production") {
          console.warn(`NewsAPI ${res.status}: ${await res.text().catch(() => "")}`);
        }
        return [];
      }
      const json: NewsApiResponse = await res.json();
      if (json.status !== "ok" || !json.articles) return [];
      return json.articles.map((a) => ({
        title: a.title,
        description: a.description,
        source: a.source?.name ?? null,
        url: a.url,
        publishedAt: a.publishedAt,
      }));
    } catch (err) {
      console.warn("NewsAPI fetch failed", err);
      return [];
    }
  }
}

function nameHintFor(symbol: string): string {
  const map: Record<string, string> = {
    FSLR: "First Solar",
    TE: "T1 Energy",
    NXT: "Nextracker",
    ARRY: "Array Technologies",
    CHPT: "ChargePoint",
    SHLS: "Shoals Technologies",
    ICLN: "iShares Clean Energy",
    ENPH: "Enphase",
  };
  return map[symbol] ?? symbol;
}

let _provider: NewsProvider | undefined;
export function getNewsProvider(): NewsProvider {
  if (!_provider) _provider = new HybridNewsProvider();
  return _provider;
}
