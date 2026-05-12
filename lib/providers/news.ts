// NewsAPI provider. Free tier disallows server-side production use; on Vercel
// these calls will be blocked. For Phase 2 the news component degrades to an
// empty array, and the agent prompt continues without news context.

export interface NewsHeadline {
  title: string;
  description: string | null;
  source: string | null;
  url: string;
  publishedAt: string; // ISO
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

class NewsApiProvider implements NewsProvider {
  async forSymbol(symbol: string, hoursBack = 24): Promise<NewsHeadline[]> {
    return this.search(`"${symbol}" OR ${nameHintFor(symbol)}`, hoursBack);
  }

  async search(query: string, hoursBack = 24): Promise<NewsHeadline[]> {
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
  if (!_provider) _provider = new NewsApiProvider();
  return _provider;
}
