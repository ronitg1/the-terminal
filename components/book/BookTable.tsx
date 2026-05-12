"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn, formatPct, formatPrice } from "@/lib/utils";
import type { Ticker, TickerTier } from "@/lib/types/db";
import type { BulkMetaRow } from "@/app/api/tickers/bulk-meta/route";
import { TierBadge } from "./TierBadge";
import { ThesisStatusBadge } from "./ThesisStatusBadge";
import { RevisionArrow } from "./RevisionArrow";
import { ImpliedMoveSparkline } from "./ImpliedMoveSparkline";
import { TickerDetailDrawer } from "./TickerDetailDrawer";
import { AddTickerDialog } from "./AddTickerDialog";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Props { initialTickers: Ticker[] }

export function BookTable({ initialTickers }: Props) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const { data: tickersData, mutate: mutateTickers } = useSWR<{ tickers: Ticker[] }>(
    "/api/tickers",
    fetcher,
    { fallbackData: { tickers: initialTickers }, refreshInterval: 0 },
  );
  const tickers = tickersData?.tickers ?? [];

  const { data: metaData } = useSWR<{ meta: BulkMetaRow[] }>("/api/tickers/bulk-meta", fetcher, {
    refreshInterval: 60_000,
    dedupingInterval: 30_000,
  });
  const metaBySym = useMemo(() => {
    const m = new Map<string, BulkMetaRow>();
    for (const row of metaData?.meta ?? []) m.set(row.symbol, row);
    return m;
  }, [metaData]);

  const sorted = useMemo(() => {
    return [...tickers].sort((a, b) => a.tier - b.tier || a.symbol.localeCompare(b.symbol));
  }, [tickers]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-semibold uppercase tracking-wider">My Names</div>
        <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Add ticker
        </Button>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12">Tier</TableHead>
              <TableHead className="w-20">Symbol</TableHead>
              <TableHead>Name</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Day %</TableHead>
              <TableHead className="text-right">52w Range</TableHead>
              <TableHead className="text-right">IV Move</TableHead>
              <TableHead className="text-right">SI %</TableHead>
              <TableHead className="text-center">Rev</TableHead>
              <TableHead className="text-center">Thesis</TableHead>
              <TableHead className="text-right">IV History</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((t) => (
              <BookRow
                key={t.id}
                ticker={t}
                meta={metaBySym.get(t.symbol)}
                onClick={() => setOpenId(t.id)}
              />
            ))}
            {sorted.length === 0 && (
              <TableRow>
                <TableCell colSpan={11} className="py-8 text-center text-sm text-muted-foreground">
                  No tickers yet. Click <span className="font-medium">Add ticker</span> to start your book.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <TickerDetailDrawer
        tickerId={openId}
        open={openId !== null}
        onOpenChange={(o) => !o && setOpenId(null)}
        onMutated={() => mutateTickers()}
      />
      <AddTickerDialog open={addOpen} onOpenChange={setAddOpen} onAdded={() => mutateTickers()} />
    </div>
  );
}

function BookRow({ ticker, meta, onClick }: { ticker: Ticker; meta: BulkMetaRow | undefined; onClick: () => void }) {
  const dayPct = meta?.quote.changePct ?? null;
  const tierBorder = TIER_BORDER[ticker.tier];
  return (
    <TableRow className={cn("cursor-pointer border-l-2", tierBorder)} onClick={onClick}>
      <TableCell><TierBadge tier={ticker.tier} /></TableCell>
      <TableCell className="font-semibold">{ticker.symbol}</TableCell>
      <TableCell className="max-w-[18ch] truncate text-muted-foreground">{ticker.name}</TableCell>
      <TableCell className="text-right">{formatPrice(meta?.quote.price)}</TableCell>
      <TableCell className={cn("text-right", dayPct == null ? "text-muted-foreground" : dayPct >= 0 ? "text-gain" : "text-loss")}>
        {formatPct(dayPct)}
      </TableCell>
      <TableCell className="text-right text-muted-foreground text-xs">
        {meta?.quote.low52w != null && meta?.quote.high52w != null
          ? `${formatPrice(meta.quote.low52w)}–${formatPrice(meta.quote.high52w)}`
          : "—"}
      </TableCell>
      <TableCell className="text-right">{formatPct(meta?.impliedMovePct ?? null, 1)}</TableCell>
      <TableCell className="text-right">{meta?.siPct != null ? `${meta.siPct.toFixed(1)}%` : "—"}</TableCell>
      <TableCell className="text-center"><div className="flex justify-center"><RevisionArrow dir={meta?.revisionDirection} /></div></TableCell>
      <TableCell className="text-center"><ThesisStatusBadge status={meta?.lastThesis?.status} /></TableCell>
      <TableCell className="text-right"><div className="flex justify-end text-tier1"><ImpliedMoveSparkline values={meta?.impliedMoveHistory ?? []} /></div></TableCell>
    </TableRow>
  );
}

const TIER_BORDER: Record<TickerTier, string> = {
  1: "border-l-tier1",
  2: "border-l-tier2",
  3: "border-l-tier3",
};
