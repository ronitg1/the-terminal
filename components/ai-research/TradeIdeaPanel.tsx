"use client";

import { useState } from "react";
import useSWR from "swr";
import { ChevronDown, ChevronRight, History, Sparkles, Star, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import type { TradeIdeaRow } from "@/app/api/agent/trade-ideas/route";

interface Contract {
  side: "buy" | "sell";
  type: "call" | "put";
  strike: number;
  expiry: string;
  quantity: number;
  estimatedDebit?: number | null;
}

interface ShareTrade {
  direction: "long" | "short";
  quantity: number;
  notional?: number | null;
}

interface TradeDetails {
  type: "options" | "stock";
  expiry?: string | null;
  contracts?: Contract[] | null;
  shares?: ShareTrade | null;
  estimatedCostUsd?: number | null;
}

interface SizingBlock {
  capitalAtRiskUsd?: number | null;
  maxLossUsd?: number | null;
  pctOfBook?: number | null;
  narrative?: string;
}

interface RiskRewardBlock {
  targetGainUsd?: number | null;
  rMultiple?: number | null;
  narrative?: string;
}

interface EntryPlanBlock {
  trigger?: string;
  limitPrice?: number | null;
  validUntil?: string;
}

interface ExitPlanBlock {
  priceTargetUp?: number | null;
  priceTargetDown?: number | null;
  trimOnBeat?: string;
  stopOnMiss?: string;
  timeStop?: string;
}

interface TradeIdea {
  symbol: string;
  rationale: string;
  structure: string;
  directionalBias?: "bullish" | "bearish" | "neutral_vol";
  tradeDetails?: TradeDetails;
  sizing: SizingBlock | string;          // legacy rows stored a free-form string
  riskReward?: RiskRewardBlock;
  entryPlan?: EntryPlanBlock;
  exitPlan?: ExitPlanBlock | { trimOnBeat: string; stopOnMiss: string };
  expectedHoldingDays?: number | null;
  successProbability?: number | null;
  risks: string[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function TradeIdeaPanel() {
  const [generated, setGenerated] = useState<TradeIdea | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const { data: history, mutate: mutateHistory } = useSWR<{ ideas: TradeIdeaRow[] }>(
    "/api/agent/trade-ideas",
    fetcher,
    { revalidateOnFocus: true },
  );
  const ideas = history?.ideas ?? [];

  async function generate() {
    setLoading(true);
    setError(null);
    setGenerated(null);
    try {
      const res = await fetch("/api/agent/trade-idea", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      if (!j.tradeIdea) throw new Error("Agent returned no idea");
      setGenerated(j.tradeIdea);
      mutateHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  async function deleteIdea(id: string) {
    if (!confirm("Delete this past trade idea?")) return;
    const res = await fetch(`/api/agent/trade-ideas?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) mutateHistory();
  }

  const [trackingId, setTrackingId] = useState<string | null>(null);

  async function toggleTrack(id: string, currentlyTracked: boolean) {
    setTrackingId(id);
    try {
      const res = await fetch(`/api/agent/trade-ideas/${id}/track`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: currentlyTracked ? "untrack" : "track" }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      // Await the refetch so the UI updates before the spinner clears.
      await mutateHistory();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTrackingId(null);
    }
  }

  const displayRow: TradeIdeaRow | null = ideas[0] ?? null;
  const displayIdea: TradeIdea | null = generated ?? (displayRow ? rowToIdea(displayRow) : null);
  const displayDate: string | null = generated ? new Date().toISOString() : displayRow?.generated_at ?? null;
  const pastIdeas = generated ? ideas : ideas.slice(1);

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Trade idea
          {displayDate && (
            <span className="ml-2 normal-case tracking-normal opacity-70">{timeAgo(displayDate)}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {displayRow && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => toggleTrack(displayRow.id, displayRow.is_tracked)}
              disabled={trackingId === displayRow.id}
              className={cn(
                "transition-colors",
                displayRow.is_tracked && "border-tier1 bg-tier1/15 text-tier1 hover:bg-tier1/25",
              )}
              title={displayRow.is_tracked ? "Stop tracking — removes from P&L tab" : "Track this idea on the P&L tab"}
            >
              <Star
                className={cn(
                  "mr-1 h-3 w-3",
                  displayRow.is_tracked && "fill-current text-tier1",
                  trackingId === displayRow.id && "animate-pulse",
                )}
              />
              {trackingId === displayRow.id
                ? "…"
                : displayRow.is_tracked
                ? "Tracking"
                : "Track"}
            </Button>
          )}
          <Button size="sm" onClick={generate} disabled={loading}>
            <Sparkles className="mr-1 h-3 w-3" />
            {loading ? "Thinking…" : "Generate"}
          </Button>
        </div>
      </div>

      <div className="p-3 text-xs">
        {!displayIdea && !error && !loading && (
          <div className="text-muted-foreground">
            Synthesizes T1 thesis snapshots + implied moves + live option chains into one highest-conviction earnings setup with concrete contracts.
          </div>
        )}
        {loading && <div className="text-muted-foreground">Agent is selecting the best risk/reward in your book…</div>}
        {error && <div className="text-loss">{error}</div>}
        {displayIdea && <IdeaBody idea={displayIdea} />}
      </div>

      {pastIdeas.length > 0 && (
        <div className="border-t">
          <button
            onClick={() => setHistoryOpen((o) => !o)}
            className="flex w-full items-center justify-between px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground hover:bg-accent/40"
          >
            <span className="inline-flex items-center gap-1">
              <History className="h-3 w-3" /> Past ideas ({pastIdeas.length})
            </span>
            {historyOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </button>
          {historyOpen && (
            <ul className="divide-y border-t">
              {pastIdeas.map((row) => (
                <li key={row.id}>
                  <PastIdeaRow
                    row={row}
                    onDelete={() => deleteIdea(row.id)}
                    onToggleTrack={() => toggleTrack(row.id, row.is_tracked)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function IdeaBody({ idea }: { idea: TradeIdea }) {
  const sizing: SizingBlock | null =
    typeof idea.sizing === "object" && idea.sizing !== null ? (idea.sizing as SizingBlock) : null;
  const sizingText = typeof idea.sizing === "string" ? idea.sizing : null;
  const exitPlan = idea.exitPlan as ExitPlanBlock | undefined;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-base font-semibold">{idea.symbol}</span>
        <span className="rounded-sm border bg-accent px-1.5 py-0.5 text-[10px] uppercase">
          {prettyStructure(idea.structure)}
        </span>
        {idea.directionalBias && (
          <span
            className={cn(
              "rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
              idea.directionalBias === "bullish" && "border-gain/40 bg-gain/10 text-gain",
              idea.directionalBias === "bearish" && "border-loss/40 bg-loss/10 text-loss",
              idea.directionalBias === "neutral_vol" && "border-muted-foreground/40 bg-muted text-muted-foreground",
            )}
          >
            {idea.directionalBias === "neutral_vol" ? "vol play" : idea.directionalBias}
          </span>
        )}
        {idea.successProbability != null && (
          <span className="ml-auto rounded-sm border bg-secondary px-1.5 py-0.5 font-mono text-[10px]">
            conv {idea.successProbability}/10
          </span>
        )}
      </div>
      <Field label="Rationale">{idea.rationale}</Field>
      <ContractsBlock details={idea.tradeDetails} />

      {/* Risk / sizing summary tiles */}
      {(sizing?.capitalAtRiskUsd != null ||
        sizing?.maxLossUsd != null ||
        idea.riskReward?.rMultiple != null ||
        idea.riskReward?.targetGainUsd != null ||
        idea.expectedHoldingDays != null ||
        idea.entryPlan?.limitPrice != null) && (
        <Field label="Risk &amp; reward">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sizing?.maxLossUsd != null && (
              <Stat label="Max loss" value={`$${Math.round(sizing.maxLossUsd).toLocaleString()}`} tone="loss" />
            )}
            {sizing?.capitalAtRiskUsd != null && sizing.capitalAtRiskUsd !== sizing.maxLossUsd && (
              <Stat label="Capital at risk" value={`$${Math.round(sizing.capitalAtRiskUsd).toLocaleString()}`} />
            )}
            {sizing?.pctOfBook != null && (
              <Stat label="% of book" value={`${sizing.pctOfBook.toFixed(2)}%`} />
            )}
            {idea.riskReward?.targetGainUsd != null && (
              <Stat label="Target gain" value={`$${Math.round(idea.riskReward.targetGainUsd).toLocaleString()}`} tone="gain" />
            )}
            {idea.riskReward?.rMultiple != null && (
              <Stat label="R:R" value={`${idea.riskReward.rMultiple.toFixed(2)}x`} tone={idea.riskReward.rMultiple >= 1.5 ? "gain" : undefined} />
            )}
            {idea.expectedHoldingDays != null && (
              <Stat label="Hold" value={`${idea.expectedHoldingDays}d`} />
            )}
            {idea.entryPlan?.limitPrice != null && (
              <Stat label="Limit" value={`$${idea.entryPlan.limitPrice}`} />
            )}
          </div>
          {(sizing?.narrative || idea.riskReward?.narrative || sizingText) && (
            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {sizing?.narrative || idea.riskReward?.narrative || sizingText}
            </p>
          )}
        </Field>
      )}

      {idea.entryPlan?.trigger && idea.entryPlan.trigger !== "now" && (
        <Field label="Entry trigger">{idea.entryPlan.trigger}{idea.entryPlan.validUntil ? ` · valid until ${idea.entryPlan.validUntil}` : ""}</Field>
      )}

      {(exitPlan?.priceTargetUp != null || exitPlan?.priceTargetDown != null) && (
        <Field label="Price targets">
          <div className="flex flex-wrap gap-2 text-[11px] font-mono">
            {exitPlan?.priceTargetUp != null && (
              <span className="rounded-sm border border-gain/40 bg-gain/10 px-1.5 py-0.5 text-gain">↑ ${exitPlan.priceTargetUp}</span>
            )}
            {exitPlan?.priceTargetDown != null && (
              <span className="rounded-sm border border-loss/40 bg-loss/10 px-1.5 py-0.5 text-loss">↓ ${exitPlan.priceTargetDown}</span>
            )}
          </div>
        </Field>
      )}

      {exitPlan?.trimOnBeat && <Field label="Trim on beat">{exitPlan.trimOnBeat}</Field>}
      {exitPlan?.stopOnMiss && <Field label="Stop on miss">{exitPlan.stopOnMiss}</Field>}
      {exitPlan?.timeStop && <Field label="Time stop">{exitPlan.timeStop}</Field>}

      {idea.risks?.length > 0 && (
        <Field label="Risks">
          <ul className="list-inside list-disc">
            {idea.risks.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </Field>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-md border bg-secondary/40 p-1.5">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-0.5 font-mono text-sm font-semibold",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function ContractsBlock({ details }: { details?: TradeDetails }) {
  if (!details) return null;
  if (details.type === "stock" && details.shares) {
    const s = details.shares;
    return (
      <Field label="Execution">
        <div className="rounded-md border bg-secondary/40 p-2 font-mono text-[11px]">
          <span className="font-semibold uppercase">{s.direction}</span> {s.quantity} shares
          {s.notional != null && <span className="ml-2 text-muted-foreground">≈ ${s.notional.toLocaleString()}</span>}
        </div>
      </Field>
    );
  }
  if (details.type === "options" && details.contracts && details.contracts.length > 0) {
    return (
      <Field label="Contracts">
        <div className="overflow-x-auto rounded-md border bg-secondary/40">
          <table className="w-full text-[11px] font-mono">
            <thead className="text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-2 py-1 text-left">Side</th>
                <th className="px-2 py-1 text-left">Type</th>
                <th className="px-2 py-1 text-right">Strike</th>
                <th className="px-2 py-1 text-left">Expiry</th>
                <th className="px-2 py-1 text-right">Qty</th>
                <th className="px-2 py-1 text-right">Est debit</th>
              </tr>
            </thead>
            <tbody>
              {details.contracts.map((c, i) => (
                <tr key={i} className="border-t">
                  <td className="px-2 py-1 uppercase">{c.side}</td>
                  <td className={cn("px-2 py-1 uppercase", c.type === "call" ? "text-gain" : "text-loss")}>{c.type}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{c.strike}</td>
                  <td className="px-2 py-1">{c.expiry}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{c.quantity}</td>
                  <td className="px-2 py-1 text-right tabular-nums">
                    {c.estimatedDebit != null ? `$${c.estimatedDebit.toFixed(2)}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {details.estimatedCostUsd != null && (
          <div className="mt-1 text-[11px] text-muted-foreground">
            Est. total cost: <span className="font-semibold text-foreground">${details.estimatedCostUsd.toLocaleString()}</span>
          </div>
        )}
      </Field>
    );
  }
  return null;
}

function PastIdeaRow({
  row,
  onDelete,
  onToggleTrack,
}: {
  row: TradeIdeaRow;
  onDelete: () => void;
  onToggleTrack: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const idea = rowToIdea(row);
  return (
    <div className={cn("px-3 py-2 text-xs transition-colors", expanded && "bg-accent/40")}>
      <div className="flex items-center gap-2">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="flex flex-1 items-center gap-2 text-left hover:text-foreground"
        >
          {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
          <span className="w-12 font-semibold tabular-nums">{row.symbol}</span>
          {row.structure && (
            <span className="rounded-sm border bg-secondary px-1.5 py-0.5 text-[9px] uppercase">{prettyStructure(row.structure)}</span>
          )}
          {row.is_tracked && (
            <span className="rounded-sm border border-tier1/40 bg-tier1/15 px-1.5 py-0.5 text-[9px] uppercase text-tier1">Tracked</span>
          )}
          {row.closed_at && (
            <span className="rounded-sm border bg-muted px-1.5 py-0.5 text-[9px] uppercase text-muted-foreground">Closed</span>
          )}
          <span className="ml-auto text-muted-foreground">{timeAgo(row.generated_at)}</span>
        </button>
        <button
          onClick={onToggleTrack}
          className={cn(
            "rounded-sm p-1 transition-colors",
            row.is_tracked
              ? "text-tier1 hover:bg-tier1/10"
              : "text-muted-foreground hover:bg-tier1/10 hover:text-tier1",
          )}
          aria-label={row.is_tracked ? "Untrack" : "Track"}
          title={row.is_tracked ? "Stop tracking" : "Track on P&L tab"}
        >
          <Star className={cn("h-3 w-3", row.is_tracked && "fill-current")} />
        </button>
        <button
          onClick={onDelete}
          className="rounded-sm p-1 text-muted-foreground hover:bg-loss/10 hover:text-loss"
          aria-label="Delete"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-2 pl-5">
          <IdeaBody idea={idea} />
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function prettyStructure(s: string): string {
  return s.replace(/_/g, " ");
}

function rowToIdea(row: TradeIdeaRow): TradeIdea {
  // Prefer the full raw JSON (post-upgrade saves). Fall back to flat columns for old rows.
  const raw = row.raw as Partial<TradeIdea> | null;
  if (raw && typeof raw === "object" && raw.symbol) {
    return {
      symbol: raw.symbol ?? row.symbol,
      rationale: raw.rationale ?? row.rationale ?? "",
      structure: raw.structure ?? row.structure ?? "",
      directionalBias: raw.directionalBias,
      tradeDetails: raw.tradeDetails,
      sizing: raw.sizing ?? row.sizing ?? "",
      riskReward: raw.riskReward,
      entryPlan: raw.entryPlan,
      exitPlan:
        raw.exitPlan ??
        ({ trimOnBeat: row.trim_on_beat ?? "", stopOnMiss: row.stop_on_miss ?? "" } as ExitPlanBlock),
      expectedHoldingDays: raw.expectedHoldingDays ?? null,
      successProbability: raw.successProbability ?? null,
      risks: raw.risks ?? row.risks ?? [],
    };
  }
  return {
    symbol: row.symbol,
    rationale: row.rationale ?? "",
    structure: row.structure ?? "",
    sizing: row.sizing ?? "",
    risks: row.risks ?? [],
    exitPlan: {
      trimOnBeat: row.trim_on_beat ?? "",
      stopOnMiss: row.stop_on_miss ?? "",
    } as ExitPlanBlock,
  };
}
