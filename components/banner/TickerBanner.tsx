"use client";

import useSWR from "swr";
import { cn, formatPct, formatPrice } from "@/lib/utils";

const BANNER_SYMBOLS = [
  { sym: "^GSPC",     label: "SPX" },
  { sym: "^NDX",      label: "NDX" },
  { sym: "^RUT",      label: "RTY" },
  { sym: "^DJI",      label: "DJI" },
  { sym: "DX-Y.NYB",  label: "DXY" },
  { sym: "^TNX",      label: "10Y" },
  { sym: "^VIX",      label: "VIX" },
  { sym: "ICLN",      label: "ICLN" },
  { sym: "XLE",       label: "XLE" },
  { sym: "XLU",       label: "XLU" },
  { sym: "TAN",       label: "TAN" },
  { sym: "QCLN",      label: "QCLN" },
] as const;

interface QuoteRow {
  symbol: string;
  price: number | null;
  changePct: number | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function TickerBanner() {
  const symbolsParam = BANNER_SYMBOLS.map((b) => b.sym).join(",");
  const { data, error } = useSWR<{ quotes: QuoteRow[] }>(
    `/api/quotes?symbols=${encodeURIComponent(symbolsParam)}`,
    fetcher,
    { refreshInterval: 30_000, revalidateOnFocus: true, dedupingInterval: 15_000 },
  );

  const bySym = new Map((data?.quotes ?? []).map((q) => [q.symbol, q]));
  const items = BANNER_SYMBOLS.map((b) => ({ ...b, q: bySym.get(b.sym) }));
  const doubled = [...items, ...items];

  return (
    <div className="border-b bg-card text-xs">
      <div className="mask-marquee-fade overflow-hidden">
        <div className={cn("flex w-max gap-6 whitespace-nowrap py-1.5 animate-marquee hover:[animation-play-state:paused]")}>
          {doubled.map((b, i) => (
            <TickerChip key={`${b.sym}-${i}`} label={b.label} quote={b.q} />
          ))}
        </div>
      </div>
      {error && <div className="px-3 py-1 text-[10px] text-loss">banner error: {String(error)}</div>}
    </div>
  );
}

function TickerChip({ label, quote }: { label: string; quote: QuoteRow | undefined }) {
  const pct = quote?.changePct ?? null;
  const color = pct == null ? "text-muted-foreground" : pct >= 0 ? "text-gain" : "text-loss";
  return (
    <div className="inline-flex min-w-[120px] items-center gap-2 px-2">
      <span className="font-semibold uppercase text-foreground">{label}</span>
      <span className="text-muted-foreground tabular-nums">{quote ? formatPrice(quote.price) : "…"}</span>
      <span className={cn("tabular-nums", color)}>{quote ? formatPct(pct) : ""}</span>
    </div>
  );
}
