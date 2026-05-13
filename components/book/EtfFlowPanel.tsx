"use client";

import { useState } from "react";
import useSWR from "swr";
import { Line, LineChart, ResponsiveContainer, ReferenceLine } from "recharts";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { StaleDataBadge } from "./StaleDataBadge";
import { cn, formatCompact, formatPct, timeAgo } from "@/lib/utils";
import type { EtfFlowsResponse, EtfFlowRow } from "@/app/api/etf-flows/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Interpretation {
  headline: string;
  leaders: string[];
  laggards: string[];
  bookImplications: string[];
  watch: string[];
}

export function EtfFlowPanel() {
  const { data, error, isLoading, mutate, isValidating } = useSWR<EtfFlowsResponse>(
    "/api/etf-flows",
    fetcher,
    { refreshInterval: 0, revalidateOnFocus: false },
  );
  const [open, setOpen] = useState(false);
  const [interp, setInterp] = useState<Interpretation | null>(null);
  const [interpLoading, setInterpLoading] = useState(false);
  const [interpError, setInterpError] = useState<string | null>(null);

  async function interpret() {
    if (!data?.rows) return;
    setInterpLoading(true);
    setInterpError(null);
    setInterp(null);
    setOpen(true);
    try {
      const res = await fetch("/api/etf-flows/interpret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rows: data.rows }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setInterp(j as Interpretation);
    } catch (err) {
      setInterpError(err instanceof Error ? err.message : String(err));
    } finally {
      setInterpLoading(false);
    }
  }

  const rows = data?.rows ?? [];
  const bookSet = new Set(data?.bookFrames ?? []);

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Sector ETF flows
          </div>
          <div className="text-[10px] text-muted-foreground">
            AUM-delta minus price-return · 7d window · personalized to your book
            {data?.fetchedAt && <> · {timeAgo(data.fetchedAt)}</>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" onClick={() => mutate()} disabled={isValidating}>
            Refresh
          </Button>
          <Button size="sm" onClick={interpret} disabled={interpLoading || isLoading || rows.length === 0}>
            <Sparkles className={cn("mr-1 h-3 w-3", interpLoading && "animate-pulse")} />
            {interpLoading ? "Interpreting…" : "Interpret"}
          </Button>
        </div>
      </div>

      {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
      {error && <div className="text-xs text-loss">Flow data unavailable.</div>}

      {rows.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-4">
          {rows.map((r) => (
            <FlowCard key={r.symbol} row={r} inBook={r.frameId != null && bookSet.has(r.frameId)} />
          ))}
        </div>
      )}

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          <SheetHeader>
            <SheetTitle className="text-sm uppercase tracking-wider">Sector flow interpretation</SheetTitle>
            <SheetDescription className="text-[11px]">
              AI read on this week&apos;s sector rotation vs your book.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-3">
            {interpLoading && <div className="text-xs text-muted-foreground">Reading the rotation…</div>}
            {interpError && (
              <div className="rounded-md border border-loss/40 bg-loss/10 p-2 text-xs text-loss">{interpError}</div>
            )}
            {interp && (
              <div className="space-y-3">
                {interp.headline && <p className="text-sm font-medium leading-snug">{interp.headline}</p>}
                {interp.leaders.length > 0 && (
                  <Section label="Leaders" tone="gain">
                    <ul className="list-inside list-disc space-y-1 text-xs">
                      {interp.leaders.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </Section>
                )}
                {interp.laggards.length > 0 && (
                  <Section label="Laggards" tone="loss">
                    <ul className="list-inside list-disc space-y-1 text-xs">
                      {interp.laggards.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </Section>
                )}
                {interp.bookImplications.length > 0 && (
                  <Section label="Implications for your book">
                    <ul className="list-inside list-disc space-y-1 text-xs">
                      {interp.bookImplications.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </Section>
                )}
                {interp.watch.length > 0 && (
                  <Section label="Watch">
                    <ul className="list-inside list-disc space-y-1 text-xs">
                      {interp.watch.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </Section>
                )}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function FlowCard({ row, inBook }: { row: EtfFlowRow; inBook: boolean }) {
  const flow = row.flowUsd7d;
  const flowPct = row.flowPct7d;
  const positive = flow != null && flow >= 0;
  const flowDisplay = flow == null ? "—" : `${positive ? "+" : "-"}$${formatCompact(Math.abs(flow))}`;
  const trendData = row.trend7d.map((v, i) => ({ i, v }));

  return (
    <div
      className={cn(
        "relative rounded-md border bg-card p-2 transition-colors",
        inBook && "border-tier1/40 bg-tier1/5",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0 flex-1">
          <div className="font-semibold tabular-nums leading-none">{row.symbol}</div>
          {row.frameLabel && (
            <div className="mt-0.5 truncate text-[9px] uppercase tracking-wider text-muted-foreground">
              {row.frameLabel}
            </div>
          )}
        </div>
        {row.source === "stale" && <StaleDataBadge fetchedAt={row.fetchedAt} label="STALE" />}
        {row.source === "unavailable" && <StaleDataBadge fetchedAt={row.fetchedAt} label="N/A" />}
        {row.source === "building" && (
          <TooltipProvider delayDuration={50}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex h-4 shrink-0 items-center rounded-sm border border-muted-foreground/40 bg-muted px-1 text-[9px] uppercase tracking-wider text-muted-foreground">
                  building
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Need 7d of snapshots to infer flow. Auto-builds as you load the page.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </div>

      <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
        <div className="text-muted-foreground">AUM</div>
        <div className="text-right font-mono tabular-nums">
          {row.aum != null ? `$${formatCompact(row.aum)}` : "—"}
        </div>
        <div className="text-muted-foreground">7d flow</div>
        <div
          className={cn(
            "text-right font-mono tabular-nums font-semibold",
            flow == null ? "text-muted-foreground" : positive ? "text-gain" : "text-loss",
          )}
        >
          {flowDisplay}
        </div>
        <div className="text-muted-foreground">flow / AUM</div>
        <div
          className={cn(
            "text-right font-mono tabular-nums",
            flowPct == null ? "text-muted-foreground" : flowPct >= 0 ? "text-gain" : "text-loss",
          )}
        >
          {flowPct != null ? `${flowPct >= 0 ? "+" : ""}${flowPct.toFixed(2)}%` : "—"}
        </div>
        <div className="text-muted-foreground">1W</div>
        <div className={cn("text-right font-mono tabular-nums", returnTone(row.return1W))}>
          {formatPct(row.return1W, 2)}
        </div>
        <div className="text-muted-foreground">1M</div>
        <div className={cn("text-right font-mono tabular-nums", returnTone(row.return1M))}>
          {formatPct(row.return1M, 2)}
        </div>
      </div>

      <div className="mt-1 h-6">
        {trendData.length > 1 ? (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={trendData}>
              <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={0.5} />
              <Line
                type="monotone"
                dataKey="v"
                stroke="currentColor"
                strokeWidth={1.25}
                dot={false}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        ) : (
          <div className="text-[9px] text-muted-foreground">trend builds daily</div>
        )}
      </div>
    </div>
  );
}

function returnTone(n: number | null): string {
  if (n == null) return "text-muted-foreground";
  return n >= 0 ? "text-gain" : "text-loss";
}

function Section({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "gain" | "loss";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={cn(
          "mb-1 text-[10px] font-semibold uppercase tracking-wider",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
          !tone && "text-muted-foreground",
        )}
      >
        {label}
      </div>
      {children}
    </div>
  );
}
