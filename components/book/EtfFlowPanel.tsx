"use client";

import useSWR from "swr";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { StaleDataBadge } from "./StaleDataBadge";
import { cn, formatCompact } from "@/lib/utils";

interface FlowRow {
  symbol: string;
  flowUsd: number | null;
  aum: number | null;
  fetchedAt: string;
  source: "live" | "stale" | "unavailable";
}
interface Resp { rows: FlowRow[]; trends: { symbol: string; points: number[] }[] }

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function EtfFlowPanel() {
  const { data, error, isLoading } = useSWR<Resp>("/api/etf-flows", fetcher, {
    refreshInterval: 0,
    revalidateOnFocus: false,
  });

  return (
    <div className="rounded-md border p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Sector ETF flows · weekly</div>
        <TooltipProvider delayDuration={50}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span><Button size="sm" variant="outline" disabled>Weekly analysis</Button></span>
            </TooltipTrigger>
            <TooltipContent>AI interpretation lands in Phase 2.</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      {isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
      {error && <div className="text-xs text-loss">Flow data unavailable.</div>}

      {data && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {data.rows.map((row) => {
            const trend = data.trends.find((t) => t.symbol === row.symbol)?.points ?? [];
            const positive = row.flowUsd != null && row.flowUsd >= 0;
            return (
              <div key={row.symbol} className="rounded-md border bg-card p-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">{row.symbol}</div>
                  {row.source !== "live" && (
                    <StaleDataBadge fetchedAt={row.fetchedAt} label={row.source === "unavailable" ? "N/A" : "STALE"} />
                  )}
                </div>
                <div className="mt-1 text-[10px] uppercase text-muted-foreground">AUM</div>
                <div className="text-xs tabular-nums">{row.aum != null ? `$${formatCompact(row.aum)}` : "—"}</div>
                <div className="mt-1 text-[10px] uppercase text-muted-foreground">Flow</div>
                <div className={cn("text-sm font-semibold tabular-nums", row.flowUsd == null ? "text-muted-foreground" : positive ? "text-gain" : "text-loss")}>
                  {row.flowUsd != null ? `${positive ? "+" : "-"}$${formatCompact(Math.abs(row.flowUsd))}` : "—"}
                </div>
                <div className="mt-1 h-6">
                  {trend.length > 1 ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={trend.map((v, i) => ({ i, v }))}>
                        <Line type="monotone" dataKey="v" stroke="currentColor" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="text-[10px] text-muted-foreground">trend builds weekly</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
