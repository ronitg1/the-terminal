"use client";

import { useState } from "react";
import useSWR from "swr";
import { AlertTriangle, ChevronDown, ChevronRight, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";

interface ReadthroughRow {
  id: string;
  reporting_symbol: string;
  affected_symbol: string;
  summary: string | null;
  sentiment: "positive" | "negative" | "neutral" | null;
  data: { urgency?: string; bullets?: string[]; group?: string } | null;
  generated_at: string;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ReadthroughBanner() {
  const { data, mutate, isLoading } = useSWR<{ readthroughs: ReadthroughRow[] }>(
    "/api/news/readthroughs",
    fetcher,
    { refreshInterval: 0, revalidateOnFocus: true },
  );
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set());

  const readthroughs = (data?.readthroughs ?? []).filter((r) => !dismissedIds.has(r.id));
  const urgent = readthroughs.filter((r) => r.data?.urgency === "act_before_open");
  const monitor = readthroughs.filter((r) => r.data?.urgency === "monitor");

  async function run() {
    setRunning(true);
    setStatus(null);
    try {
      const res = await fetch("/api/news/readthroughs", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      const detected = j.detected ?? 0;
      const generated = j.generated ?? 0;
      const skipped = j.skipped ?? 0;
      setStatus(
        detected === 0
          ? j.message ?? "No peers reported in the last 7 days."
          : `Detected ${detected} peer report${detected === 1 ? "" : "s"}. Generated ${generated} new read-through${generated === 1 ? "" : "s"}${skipped > 0 ? ` (${skipped} already on file)` : ""}.`,
      );
      mutate();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  function dismiss(id: string) {
    setDismissedIds((s) => new Set([...s, id]));
  }

  const hasAny = readthroughs.length > 0;

  return (
    <div
      className={cn(
        "rounded-md border p-3",
        urgent.length > 0 ? "border-loss/40 bg-loss/10" : hasAny ? "border-amber-500/40 bg-amber-500/10" : "border-dashed bg-card",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AlertTriangle
            className={cn(
              "h-4 w-4",
              urgent.length > 0 ? "text-loss" : hasAny ? "text-amber-500" : "text-muted-foreground",
            )}
          />
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-widest">
              Peer read-throughs
              {urgent.length > 0 && (
                <span className="ml-2 rounded-sm bg-loss px-1 py-0.5 text-[9px] text-loss-foreground">
                  {urgent.length} URGENT
                </span>
              )}
            </div>
            <div className="text-[11px] text-muted-foreground">
              {hasAny
                ? `${readthroughs.length} active${monitor.length > 0 ? ` · ${monitor.length} monitor` : ""}`
                : "No read-throughs yet. Run detection to scan for recent peer earnings."}
              {status && <span className="ml-2 italic">{status}</span>}
            </div>
          </div>
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={running || isLoading}>
          <Sparkles className={cn("mr-1 h-3 w-3", running && "animate-pulse")} />
          {running ? "Scanning…" : "Scan peers"}
        </Button>
      </div>

      {hasAny && (
        <ul className="mt-3 space-y-2">
          {readthroughs.map((r) => {
            const urgency = r.data?.urgency ?? "noise";
            const sentimentColor =
              r.sentiment === "positive" ? "text-gain" : r.sentiment === "negative" ? "text-loss" : "text-muted-foreground";
            const urgencyClass =
              urgency === "act_before_open"
                ? "border-loss/40 bg-loss/10 text-loss"
                : urgency === "monitor"
                ? "border-amber-500/40 bg-amber-500/10 text-amber-500"
                : "border-muted-foreground/40 bg-muted text-muted-foreground";
            const expanded = expandedId === r.id;
            return (
              <li key={r.id} className="rounded-md border bg-card">
                <div className="flex items-center gap-2 px-3 py-2 text-xs">
                  <button
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                    className="flex flex-1 items-center gap-2 text-left hover:text-foreground"
                  >
                    {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
                    <span className="font-semibold">{r.reporting_symbol}</span>
                    <span className="text-muted-foreground">→</span>
                    <span className="font-semibold">{r.affected_symbol}</span>
                    <span className={cn("rounded-sm border px-1 text-[9px] uppercase tracking-wider", urgencyClass)}>
                      {urgency.replace(/_/g, " ")}
                    </span>
                    {r.sentiment && (
                      <span className={cn("text-[10px] uppercase tracking-wider", sentimentColor)}>{r.sentiment}</span>
                    )}
                    {r.data?.group && <span className="text-[10px] text-muted-foreground">{r.data.group}</span>}
                    <span className="ml-auto text-[10px] text-muted-foreground">{timeAgo(r.generated_at)}</span>
                  </button>
                  <button
                    onClick={() => dismiss(r.id)}
                    className="rounded-sm p-1 text-muted-foreground hover:bg-loss/10 hover:text-loss"
                    aria-label="Dismiss"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
                {expanded && (
                  <div className="space-y-2 border-t px-3 py-2 text-xs">
                    {r.summary && <p className="leading-relaxed">{r.summary}</p>}
                    {r.data?.bullets && r.data.bullets.length > 0 && (
                      <ul className="list-inside list-disc space-y-0.5">
                        {r.data.bullets.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
