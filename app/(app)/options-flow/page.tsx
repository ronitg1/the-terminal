"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { TierBadge } from "@/components/book/TierBadge";
import { InterpretDrawer } from "@/components/options-flow/InterpretDrawer";
import { cn, formatCompact, formatPrice, timeAgo } from "@/lib/utils";
import type { OptionsFlowResponse, OptionsFlowRow, FlowGroup } from "@/app/api/options-flow/route";
import type { TickerTier } from "@/lib/types/db";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

type GroupFilter = "all" | FlowGroup;

export default function OptionsFlowPage() {
  const { data, isLoading, mutate, isValidating } = useSWR<OptionsFlowResponse>(
    "/api/options-flow",
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 5 * 60_000 }, // every 5 min
  );

  const [group, setGroup] = useState<GroupFilter>("all");
  const [selected, setSelected] = useState<OptionsFlowRow | null>(null);

  const rows = data?.rows ?? [];
  const preEarnings = data?.preEarnings ?? [];

  const filtered = useMemo(() => {
    if (group === "all") return rows;
    return rows.filter((r) => r.group === group);
  }, [rows, group]);

  return (
    <ErrorBoundary>
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wider">Options flow</div>
            <div className="text-[10px] text-muted-foreground">
              Chain activity for book + mega caps + peer-group members. Front-month expiry, or the
              earnings expiry when earnings are within 35d. Yahoo data — derived activity, not
              institutional tape.
              {data?.fetchedAt && <> · refreshed {timeAgo(data.fetchedAt)}</>}
            </div>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => mutate()}
            disabled={isValidating}
          >
            <RefreshCw className={cn("mr-1 h-3 w-3", isValidating && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {preEarnings.length > 0 && (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
            <div className="mb-2 flex items-center gap-2">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-500">
                Pre-earnings — within 10 days
              </div>
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {preEarnings.map((r) => (
                <PreEarningsCard key={r.symbol} row={r} onClick={() => setSelected(r)} />
              ))}
            </div>
          </div>
        )}

        <div className="flex items-center gap-1 rounded-md border bg-card p-0.5">
          {(["all", "mine", "peer", "mega"] as GroupFilter[]).map((g) => (
            <Button
              key={g}
              size="sm"
              variant="ghost"
              onClick={() => setGroup(g)}
              className={cn(group === g && "bg-accent text-foreground")}
            >
              {g === "all" ? "All" : g === "mine" ? "My book" : g === "peer" ? "Peers" : "Mega"}
              <span className="ml-1 text-[10px] text-muted-foreground">
                ({g === "all" ? rows.length : rows.filter((r) => r.group === g).length})
              </span>
            </Button>
          ))}
        </div>

        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-14">Tier</TableHead>
                <TableHead className="w-20">Symbol</TableHead>
                <TableHead>Group</TableHead>
                <TableHead className="text-right">Spot</TableHead>
                <TableHead>Expiry</TableHead>
                <TableHead className="text-right">Call vol</TableHead>
                <TableHead className="text-right">Put vol</TableHead>
                <TableHead className="text-right">C/P</TableHead>
                <TableHead className="text-right">Notional</TableHead>
                <TableHead className="text-right">ATM IV</TableHead>
                <TableHead>Earnings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-xs text-muted-foreground">
                    Loading options chains…
                  </TableCell>
                </TableRow>
              )}
              {!isLoading && filtered.length === 0 && (
                <TableRow>
                  <TableCell colSpan={11} className="py-8 text-center text-xs text-muted-foreground">
                    No options data available.
                  </TableCell>
                </TableRow>
              )}
              {filtered.map((r) => (
                <FlowRow key={`${r.group}__${r.symbol}`} row={r} onClick={() => setSelected(r)} />
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      <InterpretDrawer
        row={selected}
        open={selected !== null}
        onOpenChange={(b) => !b && setSelected(null)}
      />
    </ErrorBoundary>
  );
}

function FlowRow({ row, onClick }: { row: OptionsFlowRow; onClick: () => void }) {
  const s = row.summary;
  const cpv = s?.callPutVolumeRatio;
  const cpvDisplay =
    cpv == null
      ? "—"
      : cpv >= 1.5
      ? `${cpv.toFixed(2)}x C`
      : cpv <= 0.67
      ? `${(1 / cpv).toFixed(2)}x P`
      : cpv.toFixed(2);
  const cpvTone = cpv == null ? "" : cpv >= 1.5 ? "text-gain" : cpv <= 0.67 ? "text-loss" : "";
  const totalNotional = s ? s.callNotionalUsd + s.putNotionalUsd : 0;
  const isPreEarnings =
    row.daysToEarnings != null && row.daysToEarnings >= 0 && row.daysToEarnings <= 10;

  return (
    <TableRow
      className={cn(
        "cursor-pointer font-mono text-xs hover:bg-accent/50",
        isPreEarnings && "bg-amber-500/5",
      )}
      onClick={onClick}
    >
      <TableCell>
        {row.tier ? (
          <TierBadge tier={row.tier as TickerTier} />
        ) : row.group === "mega" ? (
          <span className="inline-flex h-5 items-center rounded-sm border bg-muted px-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            MKT
          </span>
        ) : (
          <span className="inline-flex h-5 items-center rounded-sm border bg-muted px-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            PEER
          </span>
        )}
      </TableCell>
      <TableCell className="font-semibold">{row.symbol}</TableCell>
      <TableCell className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {row.group === "mine" ? "Book" : row.group === "peer" ? "Peer" : "Mega"}
      </TableCell>
      <TableCell className="text-right tabular-nums">{formatPrice(s?.spot)}</TableCell>
      <TableCell className="text-[10px] text-muted-foreground">
        {row.expiryUsed ?? "—"}
        {row.isEarningsExpiry && (
          <span className="ml-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 text-[9px] uppercase text-amber-500">
            ER
          </span>
        )}
      </TableCell>
      <TableCell className="text-right tabular-nums text-gain">
        {formatCompact(s?.callVolume ?? 0)}
      </TableCell>
      <TableCell className="text-right tabular-nums text-loss">
        {formatCompact(s?.putVolume ?? 0)}
      </TableCell>
      <TableCell className={cn("text-right tabular-nums font-semibold", cpvTone)}>{cpvDisplay}</TableCell>
      <TableCell className="text-right tabular-nums">${formatCompact(totalNotional)}</TableCell>
      <TableCell className="text-right tabular-nums">
        {s?.atmIv != null ? `${(s.atmIv * 100).toFixed(0)}%` : "—"}
      </TableCell>
      <TableCell className="text-[10px] text-muted-foreground">
        {row.earningsDate ? (
          <span className={cn(isPreEarnings && "font-semibold text-amber-500")}>
            {row.earningsDate} · {row.daysToEarnings}d
          </span>
        ) : (
          "—"
        )}
      </TableCell>
    </TableRow>
  );
}

function PreEarningsCard({ row, onClick }: { row: OptionsFlowRow; onClick: () => void }) {
  const s = row.summary;
  const cpv = s?.callPutVolumeRatio;
  return (
    <button
      onClick={onClick}
      className="rounded-md border bg-card p-2 text-left transition hover:border-amber-500/60"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {row.tier && <TierBadge tier={row.tier as TickerTier} />}
          <span className="font-mono text-sm font-semibold">{row.symbol}</span>
        </div>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-500">
          {row.daysToEarnings}d to ER
        </span>
      </div>
      <div className="mt-1 font-mono text-[11px] text-muted-foreground">
        Spot ${formatPrice(s?.spot)} · ATM IV {s?.atmIv != null ? `${(s.atmIv * 100).toFixed(0)}%` : "—"}
      </div>
      <div className="mt-1 flex justify-between font-mono text-[11px]">
        <span className="text-gain">C {formatCompact(s?.callVolume ?? 0)}</span>
        <span className="text-loss">P {formatCompact(s?.putVolume ?? 0)}</span>
        <span className={cn(
          "font-semibold",
          cpv != null && cpv >= 1.5 && "text-gain",
          cpv != null && cpv <= 0.67 && "text-loss",
        )}>
          {cpv == null ? "—" : `${cpv.toFixed(2)}x`}
        </span>
      </div>
    </button>
  );
}
