"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { RotateCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { ArticleCard } from "@/components/news/ArticleCard";
import { ArticleDetailSheet } from "@/components/news/ArticleDetailSheet";
import { ReadthroughBanner } from "@/components/news/ReadthroughBanner";
import { cn } from "@/lib/utils";
import type { NewsFeedResponse, NewsItem, MyTicker } from "@/app/api/news/feed/route";
import type { TickerNewsResponse } from "@/app/api/news/ticker/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function NewsPage() {
  const [sectorId, setSectorId] = useState<string | null>(null);
  const feedUrl = `/api/news/feed?hours=48${sectorId ? `&sector=${encodeURIComponent(sectorId)}` : ""}`;

  const { data, mutate, isLoading, isValidating } = useSWR<NewsFeedResponse>(feedUrl, fetcher, {
    refreshInterval: 5 * 60_000,
    revalidateOnFocus: true,
  });

  // Lock in the initial sector once we know what's available.
  useEffect(() => {
    if (!sectorId && data?.current?.frameId) setSectorId(data.current.frameId);
  }, [sectorId, data?.current?.frameId]);

  const [selected, setSelected] = useState<NewsItem | null>(null);
  const [tickerFilter, setTickerFilter] = useState<string | null>(null);

  const currentHeadlines = useMemo(() => {
    const items = data?.current?.headlines ?? [];
    return tickerFilter ? items.filter((a) => a.relatedSymbol === tickerFilter) : items;
  }, [data?.current?.headlines, tickerFilter]);

  // Reset per-ticker filter when switching sectors.
  useEffect(() => {
    setTickerFilter(null);
  }, [data?.current?.frameId]);

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wider">News</div>
          <div className="text-[10px] text-muted-foreground">
            Sector taxonomy → headlines for your book + representative names · ad-hoc ticker search · macro/econ-only feed.
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={() => mutate()} disabled={isValidating}>
          <RotateCw className={cn("mr-1 h-3 w-3", isValidating && "animate-spin")} /> Refresh
        </Button>
      </div>

      <ErrorBoundary label="Peer read-throughs">
        <ReadthroughBanner />
      </ErrorBoundary>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden lg:grid-cols-3">
        <ErrorBoundary label="Sector feed">
          <SectorColumn
            sectors={data?.sectors ?? []}
            current={data?.current ?? null}
            currentHeadlines={currentHeadlines}
            sectorId={sectorId}
            onSelectSector={setSectorId}
            tickerFilter={tickerFilter}
            onTickerFilter={setTickerFilter}
            onSelectArticle={setSelected}
            loading={isLoading}
          />
        </ErrorBoundary>

        <ErrorBoundary label="Ticker search">
          <TickerSearchColumn
            myTickers={data?.myTickers ?? []}
            onSelectArticle={setSelected}
          />
        </ErrorBoundary>

        <ErrorBoundary label="Macro / econ">
          <MacroColumn
            articles={data?.macro ?? []}
            onSelectArticle={setSelected}
            loading={isLoading}
          />
        </ErrorBoundary>
      </div>

      <ArticleDetailSheet
        article={selected}
        open={selected !== null}
        onOpenChange={(o) => !o && setSelected(null)}
      />
    </div>
  );
}

// ============================================================================
// Sector column — all sectors as pills; selected sector shows tickers + news.
// ============================================================================

function SectorColumn({
  sectors,
  current,
  currentHeadlines,
  sectorId,
  onSelectSector,
  tickerFilter,
  onTickerFilter,
  onSelectArticle,
  loading,
}: {
  sectors: NewsFeedResponse["sectors"];
  current: NewsFeedResponse["current"];
  currentHeadlines: NewsItem[];
  sectorId: string | null;
  onSelectSector: (id: string) => void;
  tickerFilter: string | null;
  onTickerFilter: (s: string | null) => void;
  onSelectArticle: (a: NewsItem) => void;
  loading: boolean;
}) {
  const bookTickers = current?.tickers.filter((t) => t.inBook) ?? [];
  const defaultTickers = current?.tickers.filter((t) => !t.inBook) ?? [];
  const hasBookInSector = bookTickers.length > 0;

  return (
    <Column
      title={current ? current.label : "Sector"}
      subtitle={
        current
          ? `${currentHeadlines.length} articles · benchmark ${current.benchmarkSymbol}`
          : "—"
      }
      extra={
        <div className="space-y-1.5">
          {/* Sector pills — full taxonomy, sectors with your tickers highlighted */}
          <div className="flex flex-wrap gap-1">
            {sectors.map((s) => (
              <button
                key={s.frameId}
                onClick={() => onSelectSector(s.frameId)}
                className={cn(
                  "rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider transition-colors",
                  sectorId === s.frameId
                    ? "border-foreground bg-foreground text-background"
                    : s.bookCount > 0
                    ? "border-tier1/40 bg-tier1/10 text-tier1 hover:bg-tier1/20"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
                title={
                  s.bookCount > 0
                    ? `${s.bookCount} of your tickers in ${s.label}`
                    : `${s.label} — none in book, defaults shown`
                }
              >
                {s.label}
                {s.bookCount > 0 && <span className="ml-1 opacity-80">·{s.bookCount}</span>}
              </button>
            ))}
          </div>

          {/* Per-ticker filter pills within the selected sector */}
          {current && current.tickers.length > 0 && (
            <div className="space-y-1">
              <FilterPill
                label="all"
                active={tickerFilter === null}
                onClick={() => onTickerFilter(null)}
              />
              {hasBookInSector && (
                <PillRow label="Your names">
                  {bookTickers.map((t) => (
                    <FilterPill
                      key={t.symbol}
                      label={t.symbol}
                      active={tickerFilter === t.symbol}
                      tone="book"
                      onClick={() => onTickerFilter(tickerFilter === t.symbol ? null : t.symbol)}
                    />
                  ))}
                </PillRow>
              )}
              {defaultTickers.length > 0 && (
                <PillRow label={hasBookInSector ? "Sector names" : "Representative names"}>
                  {defaultTickers.map((t) => (
                    <FilterPill
                      key={t.symbol}
                      label={t.symbol}
                      active={tickerFilter === t.symbol}
                      onClick={() => onTickerFilter(tickerFilter === t.symbol ? null : t.symbol)}
                    />
                  ))}
                </PillRow>
              )}
            </div>
          )}
        </div>
      }
    >
      {loading && currentHeadlines.length === 0 ? (
        <Empty>Loading sector feed…</Empty>
      ) : !current ? (
        <Empty>Select a sector above to see headlines.</Empty>
      ) : currentHeadlines.length === 0 ? (
        <Empty>
          No headlines in the last 48h for {tickerFilter ?? current.label}.
        </Empty>
      ) : (
        <ul className="space-y-2 p-2">
          {currentHeadlines.map((a) => (
            <li key={a.url}>
              <ArticleCard article={a} onClick={() => onSelectArticle(a)} />
            </li>
          ))}
        </ul>
      )}
    </Column>
  );
}

// ============================================================================
// Ticker search column — quick-pick pills for book tickers + search any symbol.
// ============================================================================

function TickerSearchColumn({
  myTickers,
  onSelectArticle,
}: {
  myTickers: MyTicker[];
  onSelectArticle: (a: NewsItem) => void;
}) {
  const [input, setInput] = useState("");
  const [submitted, setSubmitted] = useState<string | null>(null);

  const { data, isLoading } = useSWR<TickerNewsResponse>(
    submitted ? `/api/news/ticker?symbol=${encodeURIComponent(submitted)}&hours=168` : null,
    fetcher,
    { refreshInterval: 0 },
  );

  function submit(value?: string) {
    const v = (value ?? input).trim().toUpperCase();
    if (!v) return;
    setInput(v);
    setSubmitted(v);
  }

  const headlines = data?.headlines ?? [];

  return (
    <Column
      title="Ticker search"
      subtitle={submitted ? `${headlines.length} for ${submitted}` : "any symbol · 7d"}
      extra={
        <div className="space-y-1.5">
          <div className="flex gap-1.5">
            <div className="flex flex-1 items-center gap-1.5 rounded-md border bg-secondary/40 px-2">
              <Search className="h-3 w-3 text-muted-foreground" />
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder="e.g. NVDA, JPM, FSLR"
                className="h-7 border-0 bg-transparent px-0 font-mono text-xs focus-visible:ring-0"
              />
            </div>
            <Button size="sm" onClick={() => submit()} disabled={!input.trim() || isLoading}>
              Go
            </Button>
          </div>
          {myTickers.length > 0 && (
            <PillRow label="Your names">
              {myTickers.map((t) => (
                <FilterPill
                  key={t.symbol}
                  label={t.symbol}
                  active={submitted === t.symbol}
                  tone="book"
                  onClick={() => submit(t.symbol)}
                />
              ))}
            </PillRow>
          )}
        </div>
      }
    >
      <div className="space-y-2 p-2">
        {!submitted && (
          <div className="rounded-md border border-dashed p-3 text-[11px] text-muted-foreground">
            Click one of your names above or type any ticker to pull a 7-day Finnhub feed for it. Doesn&apos;t affect the sector feed.
          </div>
        )}
        {isLoading && <div className="p-2 text-[11px] text-muted-foreground">Searching…</div>}
        {!isLoading && submitted && headlines.length === 0 && (
          <div className="p-2 text-[11px] text-muted-foreground">
            No headlines for {submitted} in the last 7 days.
          </div>
        )}
        {headlines.length > 0 && (
          <ul className="space-y-2">
            {headlines.map((a) => (
              <li key={a.url}>
                <ArticleCard
                  article={{ ...a, relatedSymbol: submitted } as NewsItem}
                  onClick={() => onSelectArticle({ ...a, relatedSymbol: submitted } as NewsItem)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Column>
  );
}

// ============================================================================
// Macro column
// ============================================================================

function MacroColumn({
  articles,
  onSelectArticle,
  loading,
}: {
  articles: NewsItem[];
  onSelectArticle: (a: NewsItem) => void;
  loading: boolean;
}) {
  return (
    <Column title="Macro / econ" subtitle={`${articles.length} articles`}>
      {loading && articles.length === 0 ? (
        <Empty>Loading macro feed…</Empty>
      ) : articles.length === 0 ? (
        <Empty>
          No macro headlines. Edit search terms on Settings → Macro &amp; sector search.
        </Empty>
      ) : (
        <ul className="space-y-2 p-2">
          {articles.map((a) => (
            <li key={a.url}>
              <ArticleCard article={a} onClick={() => onSelectArticle(a)} />
            </li>
          ))}
        </ul>
      )}
    </Column>
  );
}

// ============================================================================
// Shared layout primitives
// ============================================================================

function Column({
  title,
  subtitle,
  extra,
  children,
}: {
  title: string;
  subtitle: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-col rounded-md border bg-card">
      <div className="space-y-2 border-b px-3 py-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            {title}
          </span>
          <span className="text-[10px] text-muted-foreground">{subtitle}</span>
        </div>
        {extra}
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="p-6 text-center text-xs text-muted-foreground">{children}</div>;
}

function PillRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </div>
      <div className="mt-0.5 flex flex-wrap gap-1">{children}</div>
    </div>
  );
}

function FilterPill({
  label,
  active,
  tone,
  onClick,
}: {
  label: string;
  active: boolean;
  tone?: "book";
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tracking-wider transition-colors",
        active
          ? "border-foreground bg-foreground text-background"
          : tone === "book"
          ? "border-tier1/40 text-tier1 hover:bg-tier1/15"
          : "text-muted-foreground hover:bg-accent hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
