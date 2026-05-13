"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Line, LineChart, ResponsiveContainer, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { ThesisStatusBadge } from "@/components/book/ThesisStatusBadge";
import { ConvictionDial } from "./ConvictionDial";
import { ThesisDetailDrawer } from "./ThesisDetailDrawer";
import { timeAgo, cn } from "@/lib/utils";
import type { FeedThesisCard } from "@/app/api/agent/feed/route";

export function ThesisCard({
  card,
  onRefreshed,
  pending,
}: {
  card: FeedThesisCard;
  onRefreshed: () => void;
  pending?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  async function runNow(e: React.MouseEvent) {
    e.stopPropagation();
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/run/${encodeURIComponent(card.symbol)}`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      onRefreshed();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  const latest = card.latest;
  return (
    <>
      <div
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        className={cn(
          "cursor-pointer rounded-md border bg-card p-3 transition-colors hover:border-tier1/60 hover:bg-accent/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          pending && "border-tier1/60 bg-tier1/5",
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <ConvictionDial value={latest?.conviction ?? null} />
            <div>
              <div className="flex items-baseline gap-2">
                <span className="text-base font-semibold">{card.symbol}</span>
                <ThesisStatusBadge status={latest?.status} />
              </div>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {pending ? (
                  <span className="inline-flex items-center gap-1 text-tier1">
                    <RefreshCw className="h-2.5 w-2.5 animate-spin" /> agent running…
                  </span>
                ) : latest ? (
                  `updated ${timeAgo(latest.generated_at)}`
                ) : (
                  "no snapshot yet"
                )}
              </div>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={runNow} disabled={running}>
            <RefreshCw className={cn("mr-1 h-3 w-3", running && "animate-spin")} />
            {running ? "Running" : "Run now"}
          </Button>
        </div>

        {latest && (
          <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-xs text-muted-foreground">
            {latest.content}
          </p>
        )}

        {latest && (
          <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground/70">
            Click to read full thesis
          </div>
        )}

        {card.history.length > 1 && (
          <div className="mt-2 h-10">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={card.history}>
                <Line
                  type="monotone"
                  dataKey="conviction"
                  stroke="hsl(var(--tier1))"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <YAxis hide domain={[1, 10]} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        {error && <div className="mt-2 text-[11px] text-loss">{error}</div>}
      </div>

      <ThesisDetailDrawer card={card} open={open} onOpenChange={setOpen} />
    </>
  );
}
