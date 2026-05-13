"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn, formatCompact, formatPrice } from "@/lib/utils";
import type { OptionsFlowRow } from "@/app/api/options-flow/route";
import type { ChainSummary } from "@/lib/providers/options";

interface InterpretResult {
  bias: "bullish" | "bearish" | "mixed" | "neutral";
  confidence: "low" | "medium" | "high";
  headline: string;
  evidence: string[];
  thesisAlignment: "confirms" | "contradicts" | "neutral" | "n/a";
  thesisAlignmentReason: string;
  watch: string[];
  summary: ChainSummary;
}

const BIAS_COLOR: Record<InterpretResult["bias"], string> = {
  bullish: "border-gain/40 bg-gain/10 text-gain",
  bearish: "border-loss/40 bg-loss/10 text-loss",
  mixed: "border-amber-500/40 bg-amber-500/10 text-amber-500",
  neutral: "border-muted-foreground/40 bg-muted text-muted-foreground",
};

const ALIGN_COLOR: Record<InterpretResult["thesisAlignment"], string> = {
  confirms: "border-gain/40 bg-gain/10 text-gain",
  contradicts: "border-loss/40 bg-loss/10 text-loss",
  neutral: "border-muted-foreground/40 bg-muted text-muted-foreground",
  "n/a": "border-muted-foreground/40 bg-muted text-muted-foreground",
};

export function InterpretDrawer({
  row,
  open,
  onOpenChange,
}: {
  row: OptionsFlowRow | null;
  open: boolean;
  onOpenChange: (b: boolean) => void;
}) {
  const [result, setResult] = useState<InterpretResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setResult(null);
      setError(null);
    }
  }, [open, row]);

  async function interpret() {
    if (!row) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/options-flow/interpret", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: row.symbol, expiry: row.expiryUsed ?? undefined }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setResult(j as InterpretResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {row && (
          <>
            <SheetHeader>
              <div className="flex items-baseline gap-2">
                <span className="rounded-sm border bg-secondary px-1.5 py-0.5 font-mono text-sm font-semibold">
                  {row.symbol}
                </span>
                <SheetTitle className="text-base leading-snug">
                  {row.name ?? row.symbol} · options flow
                </SheetTitle>
              </div>
              <SheetDescription className="text-xs">
                {row.summary?.spot != null && <>Spot ${formatPrice(row.summary.spot)} · </>}
                Expiry {row.expiryUsed ?? "—"} ({row.summary?.daysToExpiry ?? "?"}d)
                {row.isEarningsExpiry && " · earnings expiry"}
                {row.earningsDate && (
                  <>
                    {" · "}
                    earnings {row.earningsDate} ({row.daysToEarnings}d)
                  </>
                )}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {row.summary && <ChainStats summary={row.summary} />}

              <div className="flex gap-2">
                <Button size="sm" onClick={interpret} disabled={loading || !row.summary}>
                  <Sparkles className={cn("mr-1 h-3 w-3", loading && "animate-pulse")} />
                  {loading ? "Interpreting…" : result ? "Re-run interpretation" : "Interpret flow"}
                </Button>
              </div>

              {error && (
                <div className="rounded-md border border-loss/40 bg-loss/10 p-2 text-xs text-loss">{error}</div>
              )}

              {result && (
                <div className="space-y-3 rounded-md border bg-card p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        BIAS_COLOR[result.bias],
                      )}
                    >
                      {result.bias}
                    </span>
                    <span className="rounded-sm border bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {result.confidence} conf
                    </span>
                    {result.thesisAlignment !== "n/a" && (
                      <span
                        className={cn(
                          "rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                          ALIGN_COLOR[result.thesisAlignment],
                        )}
                      >
                        {result.thesisAlignment} thesis
                      </span>
                    )}
                  </div>
                  {result.headline && (
                    <p className="text-sm font-medium leading-snug">{result.headline}</p>
                  )}
                  {result.evidence.length > 0 && (
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Evidence
                      </div>
                      <ul className="list-inside list-disc space-y-1 text-sm">
                        {result.evidence.map((e, i) => (
                          <li key={i}>{e}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {result.thesisAlignmentReason && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold uppercase tracking-wider">Thesis read:</span>{" "}
                      {result.thesisAlignmentReason}
                    </p>
                  )}
                  {result.watch.length > 0 && (
                    <div>
                      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                        Watch
                      </div>
                      <ul className="list-inside list-disc space-y-1 text-sm">
                        {result.watch.map((w, i) => (
                          <li key={i}>{w}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {row.summary && row.summary.notableContracts.length > 0 && (
                <div className="rounded-md border bg-card p-3">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    Notable contracts (by volume / OI ratio)
                  </div>
                  <div className="space-y-1 text-xs">
                    {row.summary.notableContracts.map((c, i) => (
                      <div key={i} className="flex items-center justify-between font-mono">
                        <span>
                          <span className={cn(c.type === "call" ? "text-gain" : "text-loss", "font-semibold")}>
                            {c.type.toUpperCase()}
                          </span>{" "}
                          {c.strike} · {c.expiry} ({c.daysToExpiry}d)
                        </span>
                        <span className="text-muted-foreground">
                          vol {formatCompact(c.volume)} / OI {formatCompact(c.openInterest)} ={" "}
                          <span className="text-foreground">{c.volOiRatio.toFixed(1)}x</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ChainStats({ summary }: { summary: ChainSummary }) {
  const cpv = summary.callPutVolumeRatio;
  const cpvLabel = cpv == null ? "—" : cpv >= 1 ? `${cpv.toFixed(2)}x calls` : `${(1 / cpv).toFixed(2)}x puts`;
  return (
    <div className="grid grid-cols-3 gap-2 text-xs">
      <Stat label="Call vol" value={formatCompact(summary.callVolume)} tone="gain" />
      <Stat label="Put vol" value={formatCompact(summary.putVolume)} tone="loss" />
      <Stat label="C/P vol" value={cpvLabel} />
      <Stat label="Call $ notional" value={`$${formatCompact(summary.callNotionalUsd)}`} tone="gain" />
      <Stat label="Put $ notional" value={`$${formatCompact(summary.putNotionalUsd)}`} tone="loss" />
      <Stat
        label="ATM IV"
        value={summary.atmIv != null ? `${(summary.atmIv * 100).toFixed(1)}%` : "—"}
      />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "gain" | "loss" }) {
  return (
    <div className="rounded-md border bg-card p-2">
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
