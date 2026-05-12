"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { CheckCircle2, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { cn, formatPct, formatPrice, timeAgo } from "@/lib/utils";
import type { TrackedIdea, TrackedSummary } from "@/app/api/agent/tracked/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function PnlPage() {
  const { data, mutate, isLoading } = useSWR<TrackedSummary>("/api/agent/tracked", fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
  });

  const [filter, setFilter] = useState<"all" | "open" | "closed">("open");
  const [pendingId, setPendingId] = useState<string | null>(null);

  const ideas = useMemo(() => {
    const all = data?.ideas ?? [];
    if (filter === "all") return all;
    return all.filter((i) => i.status === filter);
  }, [data?.ideas, filter]);

  async function act(id: string, action: "close" | "reopen" | "untrack") {
    setPendingId(id);
    try {
      const res = await fetch(`/api/agent/trade-ideas/${id}/track`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) mutate();
    } finally {
      setPendingId(null);
    }
  }

  const stats = data?.stats;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wider">Trade idea performance</div>
          <div className="text-[10px] text-muted-foreground">
            Tracks AI-generated ideas you&apos;ve flagged. Direction-aware: a short_stock idea &quot;wins&quot; when the underlying falls.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <FilterPill value="open" current={filter} onClick={() => setFilter("open")} count={stats?.open} />
          <FilterPill value="closed" current={filter} onClick={() => setFilter("closed")} count={stats?.closed} />
          <FilterPill value="all" current={filter} onClick={() => setFilter("all")} count={stats ? stats.open + stats.closed : undefined} />
          <Button size="sm" variant="outline" onClick={() => mutate()} disabled={isLoading}>
            <RotateCw className="mr-1 h-3 w-3" /> Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard label="Open" value={stats?.open ?? 0} />
        <StatCard label="Closed" value={stats?.closed ?? 0} />
        <StatCard
          label="Win rate"
          value={
            stats && stats.closed > 0
              ? `${((stats.winners / stats.closed) * 100).toFixed(0)}%`
              : "—"
          }
          sub={stats && stats.closed > 0 ? `${stats.winners}W / ${stats.losers}L` : undefined}
        />
        <StatCard
          label="Avg directional move"
          value={stats?.avgPctMove != null ? formatPct(stats.avgPctMove) : "—"}
          color={
            stats?.avgPctMove == null ? undefined : stats.avgPctMove >= 0 ? "gain" : "loss"
          }
        />
      </div>

      <ErrorBoundary label="Tracked ideas">
        {ideas.length === 0 ? (
          <div className="rounded-md border border-dashed p-8 text-center text-xs text-muted-foreground">
            {filter === "open"
              ? "No open tracked ideas. Go to AI Research, generate an idea, and click the star icon to track it here."
              : filter === "closed"
              ? "No closed ideas yet."
              : "No tracked ideas yet."}
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Symbol</TableHead>
                  <TableHead>Structure</TableHead>
                  <TableHead className="text-right">Entry</TableHead>
                  <TableHead className="text-right">Current / Exit</TableHead>
                  <TableHead className="text-right">Move</TableHead>
                  <TableHead className="text-right">Direction-adj</TableHead>
                  <TableHead className="text-right">Days</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right w-32">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {ideas.map((i) => (
                  <IdeaRow key={i.id} idea={i} onAction={act} pending={pendingId === i.id} />
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </ErrorBoundary>
    </div>
  );
}

function FilterPill({
  value,
  current,
  count,
  onClick,
}: {
  value: string;
  current: string;
  count: number | undefined;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-sm border px-2 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
        current === value
          ? "border-foreground bg-foreground text-background"
          : "text-muted-foreground hover:bg-accent",
      )}
    >
      {value}
      {count != null && <span className="ml-1 opacity-70">({count})</span>}
    </button>
  );
}

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: "gain" | "loss";
}) {
  return (
    <div className="rounded-md border bg-card p-3">
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold tabular-nums",
          color === "gain" && "text-gain",
          color === "loss" && "text-loss",
        )}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-muted-foreground">{sub}</div>}
    </div>
  );
}

function IdeaRow({
  idea,
  onAction,
  pending,
}: {
  idea: TrackedIdea;
  onAction: (id: string, action: "close" | "reopen" | "untrack") => void;
  pending: boolean;
}) {
  const move = idea.spot_pct_move;
  const isBearish = idea.structure ? /short_stock|long_put|bear_/.test(idea.structure) : false;
  const directionAdj = move != null ? (isBearish ? -move : move) : null;

  return (
    <TableRow>
      <TableCell className="font-semibold">{idea.symbol}</TableCell>
      <TableCell className="text-muted-foreground text-xs">
        {idea.structure?.replace(/_/g, " ") ?? "—"}
      </TableCell>
      <TableCell className="text-right">${formatPrice(idea.entry_spot_price)}</TableCell>
      <TableCell className="text-right">
        ${formatPrice(idea.status === "closed" ? idea.closed_spot_price : idea.current_spot)}
      </TableCell>
      <TableCell
        className={cn(
          "text-right",
          move == null ? "text-muted-foreground" : move >= 0 ? "text-gain" : "text-loss",
        )}
      >
        {formatPct(move)}
      </TableCell>
      <TableCell
        className={cn(
          "text-right",
          directionAdj == null
            ? "text-muted-foreground"
            : directionAdj >= 0
            ? "text-gain"
            : "text-loss",
        )}
        title={isBearish ? "Bearish setup — sign flipped: idea wins when underlying falls" : undefined}
      >
        {formatPct(directionAdj)}
      </TableCell>
      <TableCell className="text-right text-xs text-muted-foreground">{idea.days_held}d</TableCell>
      <TableCell className="text-center">
        {idea.status === "open" ? (
          <span className="rounded-sm border border-tier1/40 bg-tier1/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-tier1">
            Open
          </span>
        ) : (
          <span className="rounded-sm border bg-muted px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground">
            {timeAgo(idea.closed_at!)}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <div className="inline-flex gap-1">
          {idea.status === "open" ? (
            <button
              onClick={() => onAction(idea.id, "close")}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-50"
              title="Mark as closed at current spot"
            >
              <CheckCircle2 className="h-3 w-3" /> Close
            </button>
          ) : (
            <button
              onClick={() => onAction(idea.id, "reopen")}
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:border-foreground hover:text-foreground disabled:opacity-50"
            >
              <RotateCw className="h-3 w-3" /> Reopen
            </button>
          )}
          <button
            onClick={() => onAction(idea.id, "untrack")}
            disabled={pending}
            className="inline-flex items-center rounded-sm p-1 text-muted-foreground hover:bg-loss/10 hover:text-loss disabled:opacity-50"
            title="Stop tracking this idea entirely"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </TableCell>
    </TableRow>
  );
}
