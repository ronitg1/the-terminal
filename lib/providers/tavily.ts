// Tavily search provider — used by the chat agent as a tool for live web lookups
// when the underlying model has no built-in web search (DeepSeek). Free tier is
// ~1000 searches/month, more than enough.

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  publishedDate?: string;
}

export interface TavilySearchResponse {
  query: string;
  answer: string | null;
  results: TavilyResult[];
}

export interface TavilyExtractResult {
  url: string;
  rawContent: string;
}

export async function tavilyExtract(
  url: string,
  opts?: { depth?: "basic" | "advanced" },
): Promise<TavilyExtractResult> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) {
    throw new Error("TAVILY_API_KEY is not set in .env.local");
  }
  const res = await fetch("https://api.tavily.com/extract", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      urls: [url],
      include_images: false,
      extract_depth: opts?.depth ?? "advanced",
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily extract ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    results?: Array<{ url: string; raw_content: string }>;
    failed_results?: Array<{ url: string; error: string }>;
  };
  const first = json.results?.[0];
  if (!first) {
    const failure = json.failed_results?.[0];
    throw new Error(`Tavily failed to extract: ${failure?.error ?? "no content returned"}`);
  }
  return { url: first.url, rawContent: first.raw_content };
}

export async function tavilySearch(query: string, opts?: { maxResults?: number; topic?: "general" | "news" }): Promise<TavilySearchResponse> {
  const key = process.env.TAVILY_API_KEY?.trim();
  if (!key) {
    throw new Error("TAVILY_API_KEY is not set in .env.local (sign up at tavily.com — free tier is 1k/mo)");
  }
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query,
      max_results: opts?.maxResults ?? 5,
      topic: opts?.topic ?? "general",
      search_depth: "basic",
      include_answer: true,
    }),
    cache: "no-store",
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily ${res.status}: ${body.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    query: string;
    answer?: string | null;
    results?: Array<{ title: string; url: string; content: string; published_date?: string }>;
  };
  return {
    query: json.query,
    answer: json.answer ?? null,
    results: (json.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      content: r.content,
      publishedDate: r.published_date,
    })),
  };
}
