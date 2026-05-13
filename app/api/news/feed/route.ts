// News feed — three-section layout:
//   - sectors:  list of ALL real sectors. Each sector lists "yours" (your book
//               tickers in that sector) + "default" (canonical names) so you
//               can browse any sector even if you don't own anyone there yet.
//   - current:  headlines for the selected sector (?sector=frameId). Defaults
//               to the first sector containing your tickers; otherwise the
//               first sector in the taxonomy.
//   - macro:    macro/econ-only headlines, with earnings/results keywords
//               filtered OUT.
//   - myTickers: your book's tickers (rendered as quick-pick pills under the
//               ticker search column).

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getNewsProvider, type NewsHeadline } from "@/lib/providers/news";
import { finnhubMarketNews } from "@/lib/providers/finnhub";
import { getUserSettings } from "@/lib/settings";
import {
  getFrameById,
  pickFrame,
  FRAMES,
  SECTOR_FRAME_IDS,
  type IndustryFrame,
} from "@/lib/agent/industryFrames";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type MacroCategory =
  | "monetary"      // CPI, Fed, FOMC, rates, yields
  | "geopolitics"   // China, Russia, Ukraine, Israel, sanctions, war
  | "government"   // Congress, White House, tariffs, debt ceiling, executive orders
  | "economy"      // GDP, jobs, PMI, retail sales, recession
  | "energy"       // OPEC, oil, natural gas
  | "markets";     // default bucket — broad-market / equities / sector

export interface NewsItem extends NewsHeadline {
  relatedSymbol: string | null;
  inBook?: boolean;        // true if relatedSymbol is one of the user's book tickers
  macroCategory?: MacroCategory;  // populated only for macro feed items
}

export interface SectorTicker {
  symbol: string;
  name: string | null;
  tier: number | null;       // null when ticker is a sector default, not in book
  inBook: boolean;
}

export interface SectorMeta {
  frameId: string;
  label: string;
  benchmarkSymbol: string;
  benchmarkLabel: string;
  bookCount: number;         // # of user's tickers in this sector
  tickers: SectorTicker[];   // book tickers first, then default tickers
}

export interface SectorBlock extends SectorMeta {
  headlines: NewsItem[];
}

export interface MyTicker {
  symbol: string;
  name: string | null;
  tier: number;
}

export interface MacroCategoryCount {
  category: MacroCategory;
  count: number;
}

export interface NewsFeedResponse {
  sectors: SectorMeta[];
  current: SectorBlock | null;
  macro: NewsItem[];
  macroCategoryCounts: MacroCategoryCount[];
  myTickers: MyTicker[];
  generatedAt: string;
}

const MAX_PER_SECTOR_HEADLINES = 6;
const MAX_SECTOR_FETCH_TICKERS = 6;
const MAX_MACRO_ARTICLES = 80;

// Drop earnings/company-results stories from the macro feed — those live on
// /earnings and /transcripts.
const EARNINGS_NOISE_RE =
  /\b(earnings|results|q[1-4](?:\s*'?\d{2})?|quarterly|eps|guidance|beats?|misses?|reports?\s+(profit|loss|revenue))\b/i;

// Per-category keyword patterns. First match wins (priority order in the
// `MACRO_CATEGORY_ORDER` constant below).
const MACRO_CATEGORY_PATTERNS: Array<{ category: MacroCategory; re: RegExp }> = [
  {
    category: "monetary",
    re: /\b(fed|federal reserve|fomc|powell|cpi|ppi|inflation|interest rate|rate cut|rate hike|rate decision|treasury yield|bond yield|yield curve|monetary policy|disinflation)\b/i,
  },
  {
    category: "geopolitics",
    re: /\b(china|xi jinping|beijing|russia|putin|ukraine|kyiv|moscow|israel|gaza|iran|tehran|sanctions|nato|taiwan|north korea|hamas|hezbollah|red sea|houthis|war\b)\b/i,
  },
  {
    category: "government",
    re: /\b(congress|senate|house of representatives|biden|trump|white house|debt ceiling|federal budget|government shutdown|executive order|treasury department|tariff|trade deal|export controls|capitol)\b/i,
  },
  {
    category: "economy",
    re: /\b(gdp|jobs report|payroll|nonfarm|unemployment|jobless claims|ism|pmi|retail sales|consumer confidence|recession|housing starts|durable goods|industrial production)\b/i,
  },
  {
    category: "energy",
    re: /\b(opec\+?|crude\b|oil price|brent|wti|gasoline|natural gas|saudi arabia|oil supply|oil demand|spr release|strategic petroleum)\b/i,
  },
];
const MACRO_CATEGORY_ORDER: MacroCategory[] = [
  "monetary",
  "geopolitics",
  "government",
  "economy",
  "energy",
  "markets",
];

function categorizeMacro(text: string): MacroCategory {
  for (const { category, re } of MACRO_CATEGORY_PATTERNS) {
    if (re.test(text)) return category;
  }
  return "markets";
}

export async function GET(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  const requestedSector = url.searchParams.get("sector");
  const hoursBack = Math.min(
    168,
    Math.max(6, Number.parseInt(url.searchParams.get("hours") ?? "48", 10)),
  );

  const [{ data: tickerRows }, settings] = await Promise.all([
    supabase
      .from("tickers")
      .select("symbol,name,tier,sector,industry,frame_id")
      .eq("user_id", user.user.id)
      .order("tier", { ascending: true })
      .order("symbol"),
    getUserSettings(supabase, user.user.id),
  ]);
  const myBook = (tickerRows ?? []) as Array<{
    symbol: string;
    name: string | null;
    tier: number;
    sector: string | null;
    industry: string | null;
    frame_id: string | null;
  }>;
  const bookSymbolSet = new Set(myBook.map((t) => t.symbol));

  // 1. Map each book ticker to its frame so we know which sector "owns" it.
  const bookByFrame = new Map<string, typeof myBook>();
  for (const t of myBook) {
    const frame: IndustryFrame = getFrameById(t.frame_id) ?? pickFrame(t.sector, t.industry);
    const arr = bookByFrame.get(frame.id) ?? [];
    arr.push(t);
    bookByFrame.set(frame.id, arr);
  }

  // 2. Build sectors[] from the FULL taxonomy, not just frames in the book.
  const sectors: SectorMeta[] = SECTOR_FRAME_IDS.map((id) => {
    const frame = FRAMES[id];
    const bookInFrame = bookByFrame.get(id) ?? [];
    const bookTickers: SectorTicker[] = bookInFrame.map((t) => ({
      symbol: t.symbol,
      name: t.name,
      tier: t.tier,
      inBook: true,
    }));
    const defaultsExtra: SectorTicker[] = frame.defaultTickers
      .filter((sym) => !bookSymbolSet.has(sym))
      .map((sym) => ({ symbol: sym, name: null, tier: null, inBook: false }));
    return {
      frameId: frame.id,
      label: frame.label,
      benchmarkSymbol: frame.benchmarkSymbol,
      benchmarkLabel: frame.benchmarkLabel,
      bookCount: bookTickers.length,
      tickers: [...bookTickers, ...defaultsExtra],
    };
  });

  // 3. Pick the sector to render.
  //    - If the URL specified one, use it (if valid).
  //    - Else, the first sector that contains the user's book.
  //    - Else, the first sector overall.
  let currentFrameId: string | null = null;
  if (requestedSector && sectors.some((s) => s.frameId === requestedSector)) {
    currentFrameId = requestedSector;
  }
  if (!currentFrameId) {
    const firstWithBook = sectors.find((s) => s.bookCount > 0);
    currentFrameId = firstWithBook?.frameId ?? sectors[0]?.frameId ?? null;
  }

  const news = getNewsProvider();

  // 4. Fetch headlines for the selected sector.
  let current: SectorBlock | null = null;
  if (currentFrameId) {
    const meta = sectors.find((s) => s.frameId === currentFrameId)!;
    // Always include the user's book tickers in this sector; fill the rest from defaults.
    const seenSym = new Set<string>();
    const fetchList: SectorTicker[] = [];
    for (const t of meta.tickers) {
      if (seenSym.has(t.symbol)) continue;
      seenSym.add(t.symbol);
      fetchList.push(t);
      if (fetchList.length >= MAX_SECTOR_FETCH_TICKERS) break;
    }
    const perTicker = await Promise.all(
      fetchList.map(async (t) => {
        const items = await news.forSymbol(t.symbol, hoursBack);
        return items.slice(0, MAX_PER_SECTOR_HEADLINES).map(
          (n) => ({ ...n, relatedSymbol: t.symbol, inBook: t.inBook } as NewsItem),
        );
      }),
    );
    const merged = dedupeByUrl(perTicker.flat()).sort(byPublishedAtDesc);
    current = { ...meta, headlines: merged };
  }

  // 5. Macro feed — primary source is Finnhub's /news?category=general which
  //    works in production (unlike NewsAPI free tier). We also pull the user's
  //    custom macroSearchTerms via NewsAPI as supplementary, since those can
  //    be sector-policy specific (FEOC, 45X, etc.).
  const [finnhubMacro, customMacro] = await Promise.all([
    finnhubMarketNews("general"),
    Promise.all(
      (settings.macroSearchTerms ?? []).map(async (term) => {
        const items = await news.search(term, hoursBack);
        return items.slice(0, 5).map((n) => ({ ...n, relatedSymbol: null } as NewsItem));
      }),
    ).then((arrs) => arrs.flat()),
  ]);

  const cutoff = Date.now() - hoursBack * 3600 * 1000;
  const finnhubItems: NewsItem[] = finnhubMacro
    .filter((a) => a.headline && a.url && a.datetime * 1000 >= cutoff)
    .map((a) => {
      const haystack = `${a.headline} ${a.summary ?? ""}`;
      return {
        title: a.headline,
        description: a.summary || null,
        source: a.source || null,
        url: a.url,
        publishedAt: new Date(a.datetime * 1000).toISOString(),
        relatedSymbol: null,
        macroCategory: categorizeMacro(haystack),
      };
    });

  const customItems: NewsItem[] = customMacro.map((n) => ({
    ...n,
    macroCategory: categorizeMacro(`${n.title} ${n.description ?? ""}`),
  }));

  const macro = dedupeByUrl([...finnhubItems, ...customItems])
    .filter((a) => !looksLikeEarnings(a))
    .sort(byPublishedAtDesc)
    .slice(0, MAX_MACRO_ARTICLES);

  // Build counts per category for the UI filter pills.
  const counts = new Map<MacroCategory, number>();
  for (const a of macro) {
    const cat = a.macroCategory ?? "markets";
    counts.set(cat, (counts.get(cat) ?? 0) + 1);
  }
  const macroCategoryCounts: MacroCategoryCount[] = MACRO_CATEGORY_ORDER.filter((c) => counts.has(c)).map(
    (c) => ({ category: c, count: counts.get(c) ?? 0 }),
  );

  const myTickers: MyTicker[] = myBook.map((t) => ({
    symbol: t.symbol,
    name: t.name,
    tier: t.tier,
  }));

  return NextResponse.json(
    {
      sectors,
      current,
      macro,
      macroCategoryCounts,
      myTickers,
      generatedAt: new Date().toISOString(),
    } satisfies NewsFeedResponse,
    { headers: { "cache-control": "no-store" } },
  );
}

function looksLikeEarnings(a: NewsItem): boolean {
  const haystack = `${a.title ?? ""} ${a.description ?? ""}`;
  return EARNINGS_NOISE_RE.test(haystack);
}

function dedupeByUrl(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  const out: NewsItem[] = [];
  for (const it of items) {
    if (!it.url || seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
  }
  return out;
}

function byPublishedAtDesc(a: NewsItem, b: NewsItem): number {
  return a.publishedAt < b.publishedAt ? 1 : a.publishedAt > b.publishedAt ? -1 : 0;
}

// Legacy type re-export — kept for back-compat with any stale imports.
export type ReactionItem = never;
