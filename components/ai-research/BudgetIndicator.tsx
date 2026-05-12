"use client";

import useSWR from "swr";
import { cn } from "@/lib/utils";

interface MonthSpend {
  spendUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  pctUsed: number;
  windowStart: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function BudgetIndicator() {
  const { data } = useSWR<MonthSpend>("/api/agent/usage", fetcher, {
    refreshInterval: 30_000,
    revalidateOnFocus: true,
  });

  if (!data) {
    return <div className="text-[10px] text-muted-foreground">…</div>;
  }

  const pct = Math.min(1, data.pctUsed);
  const barColor =
    pct >= 1 ? "bg-loss" : pct >= 0.8 ? "bg-amber-500" : pct >= 0.5 ? "bg-tier1" : "bg-gain";
  const textColor =
    pct >= 1 ? "text-loss" : pct >= 0.8 ? "text-amber-500" : "text-muted-foreground";

  return (
    <div className="flex items-center gap-2 rounded-md border bg-card px-2 py-1" title={`Resets ${new Date(data.windowStart).toLocaleDateString()} + 1 month`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Budget</div>
      <div className="h-1.5 w-16 overflow-hidden rounded-sm bg-muted">
        <div className={cn("h-full transition-all", barColor)} style={{ width: `${pct * 100}%` }} />
      </div>
      <div className={cn("text-[11px] tabular-nums", textColor)}>
        ${data.spendUsd.toFixed(2)} / ${data.budgetUsd.toFixed(0)}
      </div>
      {pct >= 1 && <span className="text-[10px] font-semibold uppercase text-loss">CAPPED</span>}
    </div>
  );
}
