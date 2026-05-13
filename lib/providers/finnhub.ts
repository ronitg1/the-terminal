// Finnhub per-company news. Free tier: 60 req/min, ample for our use.
// Sign up at finnhub.io → API Keys → paste into FINNHUB_API_KEY in .env.local.

export interface FinnhubArticle {
  category: string;
  datetime: number;     // unix seconds
  headline: string;
  id: number;
  image: string;
  related: string;
  source: string;
  summary: string;
  url: string;
}

export async function finnhubCompanyNews(
  symbol: string,
  opts?: { hoursBack?: number },
): Promise<FinnhubArticle[]> {
  const key = process.env.FINNHUB_API_KEY?.trim();
  if (!key) return [];

  const hoursBack = opts?.hoursBack ?? 168; // 7 days default; Finnhub returns up to 1 year
  const now = new Date();
  const from = new Date(now.getTime() - hoursBack * 3600 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);

  const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${fmt(from)}&to=${fmt(now)}&token=${key}`;

  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      if (process.env.NODE_ENV !== "production") {
        console.warn(`Finnhub ${res.status} for ${symbol}: ${await res.text().catch(() => "")}`);
      }
      return [];
    }
    const arr = (await res.json()) as FinnhubArticle[];
    return Array.isArray(arr) ? arr : [];
  } catch (err) {
    console.warn(`Finnhub fetch failed for ${symbol}`, err);
    return [];
  }
}
