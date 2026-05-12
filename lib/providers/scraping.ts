// Shared scraping helpers: realistic UA, retry with exponential backoff,
// error logging to scrape_errors so we can degrade the UI gracefully.
import { createAdminSupabase } from "@/lib/supabase/admin";

const DEFAULT_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export interface ScrapeOptions {
  attempts?: number;
  baseDelayMs?: number;
  timeoutMs?: number;
  source: string;
  symbol?: string;
  userId?: string;
}

export async function scrapeWithRetry(url: string, opts: ScrapeOptions): Promise<string> {
  const attempts = opts.attempts ?? 3;
  const baseDelay = opts.baseDelayMs ?? 200;
  const timeout = opts.timeoutMs ?? 8000;
  let lastErr: unknown;

  for (let i = 0; i < attempts; i++) {
    try {
      const ctrl = new AbortController();
      const tm = setTimeout(() => ctrl.abort(), timeout);
      const res = await fetch(url, {
        signal: ctrl.signal,
        headers: {
          "user-agent": DEFAULT_UA,
          accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "accept-language": "en-US,en;q=0.9",
          "cache-control": "no-cache",
        },
        cache: "no-store",
      });
      clearTimeout(tm);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      lastErr = err;
      if (i < attempts - 1) {
        await new Promise((r) => setTimeout(r, baseDelay * Math.pow(2, i)));
      }
    }
  }

  // Log to Supabase (best-effort, ignore failures)
  void logScrapeError({
    source: opts.source,
    symbol: opts.symbol,
    userId: opts.userId,
    message: lastErr instanceof Error ? lastErr.message : String(lastErr),
    attempt: attempts,
  });

  throw lastErr instanceof Error ? lastErr : new Error("scrape failed");
}

async function logScrapeError(p: { source: string; symbol?: string; userId?: string; message: string; attempt: number }) {
  try {
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return;
    const admin = createAdminSupabase();
    await admin.from("scrape_errors" as any).insert({
      source: p.source,
      symbol: p.symbol ?? null,
      user_id: p.userId ?? null,
      message: p.message,
      attempt: p.attempt,
    } as any);
  } catch {
    // swallow
  }
}
