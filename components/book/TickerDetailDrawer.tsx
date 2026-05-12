"use client";

import { useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { Trash2 } from "lucide-react";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { TierBadge } from "./TierBadge";
import { ThesisStatusBadge } from "./ThesisStatusBadge";
import { cn, formatPct, formatPrice, timeAgo } from "@/lib/utils";
import type { Ticker, ThesisSnapshot, EstimateRevisionRow, TickerTier } from "@/lib/types/db";

interface DetailResponse {
  ticker: Ticker;
  latestThesis: ThesisSnapshot | null;
  shortInterestHistory: { si_pct: number | null; fetched_at: string }[];
  estimateRevisions: EstimateRevisionRow[];
  priceHistory: { date: string; close: number }[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function TickerDetailDrawer({
  tickerId,
  open,
  onOpenChange,
  onMutated,
}: {
  tickerId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onMutated: () => void;
}) {
  const { data, mutate, isLoading } = useSWR<DetailResponse>(
    tickerId ? `/api/tickers/${tickerId}/detail` : null,
    fetcher,
  );

  const [notes, setNotes] = useState("");
  const [tier, setTier] = useState<"1" | "2" | "3">("1");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  useEffect(() => {
    if (data?.ticker) {
      setNotes(data.ticker.notes ?? "");
      setTier(String(data.ticker.tier) as "1" | "2" | "3");
    }
  }, [data?.ticker]);

  function scheduleSave(patch: { notes?: string; tier?: number }) {
    if (!tickerId) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch(`/api/tickers/${tickerId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (res.ok) {
        setSavedAt(new Date().toISOString());
        mutate();
        onMutated();
      }
    }, 500);
  }

  async function remove() {
    if (!tickerId) return;
    if (!confirm("Remove this ticker from your book?")) return;
    const res = await fetch(`/api/tickers/${tickerId}`, { method: "DELETE" });
    if (res.ok) {
      onMutated();
      onOpenChange(false);
    }
  }

  const t = data?.ticker;
  const siHistory = data?.shortInterestHistory ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <div className="flex items-baseline gap-3">
            {t && <TierBadge tier={t.tier as TickerTier} />}
            <SheetTitle className="text-xl">{t?.symbol ?? "…"}</SheetTitle>
            <SheetDescription className="text-xs">{t?.name}</SheetDescription>
          </div>
        </SheetHeader>

        {isLoading && <div className="mt-6 text-sm text-muted-foreground">Loading…</div>}

        {t && (
          <div className="mt-4 space-y-5">
            <section>
              <SectionTitle>Price · 1Y</SectionTitle>
              <div className="h-44 w-full">
                {data!.priceHistory.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={data!.priceHistory}>
                      <Line type="monotone" dataKey="close" stroke="hsl(var(--tier1))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      <XAxis dataKey="date" hide />
                      <YAxis domain={["auto", "auto"]} hide />
                      <RechartsTooltip
                        contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6, fontSize: 11 }}
                        labelFormatter={(d) => String(d)}
                        formatter={(v: number) => [formatPrice(v), "Close"]}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground">No price data</div>
                )}
              </div>
            </section>

            <Separator />

            <section className="space-y-2">
              <SectionTitle>Thesis notes</SectionTitle>
              <div className="flex items-center gap-3 text-xs">
                <span className="text-muted-foreground">Tier</span>
                <Select value={tier} onValueChange={(v) => { setTier(v as "1" | "2" | "3"); scheduleSave({ tier: Number(v) }); }}>
                  <SelectTrigger className="h-7 w-20"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">T1</SelectItem>
                    <SelectItem value="2">T2</SelectItem>
                    <SelectItem value="3">T3</SelectItem>
                  </SelectContent>
                </Select>
                {savedAt && <span className="ml-auto text-[10px] text-muted-foreground">saved {timeAgo(savedAt)}</span>}
              </div>
              <Textarea
                value={notes}
                onChange={(e) => { setNotes(e.target.value); scheduleSave({ notes: e.target.value }); }}
                rows={5}
                placeholder="Variant view, key drivers, risks, catalysts…"
              />
            </section>

            <Separator />

            <section className="space-y-2">
              <SectionTitle>Last AI thesis snapshot</SectionTitle>
              {data!.latestThesis ? (
                <div className="rounded-md border p-3">
                  <div className="flex items-center gap-2 text-xs">
                    <ThesisStatusBadge status={data!.latestThesis.status} />
                    {data!.latestThesis.conviction != null && (
                      <span className="text-muted-foreground">conviction {data!.latestThesis.conviction}/10</span>
                    )}
                    <span className="ml-auto text-muted-foreground">{timeAgo(data!.latestThesis.generated_at)}</span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{data!.latestThesis.content}</p>
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  No AI thesis yet — the background agent runs in Phase 2.
                </div>
              )}
            </section>

            <Separator />

            <section className="space-y-2">
              <SectionTitle>Short interest · 90d</SectionTitle>
              {siHistory.length > 0 ? (
                <div className="h-16 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={[...siHistory].reverse().map((s, i) => ({ i, si: s.si_pct ?? 0 }))}>
                      <Line type="monotone" dataKey="si" stroke="hsl(var(--loss))" strokeWidth={1.5} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No SI history yet</div>
              )}
            </section>

            <Separator />

            <section className="space-y-2">
              <SectionTitle>Estimate revisions</SectionTitle>
              {(data!.estimateRevisions ?? []).length > 0 ? (
                <div className="rounded-md border">
                  <table className="w-full text-xs">
                    <thead className="text-[10px] uppercase text-muted-foreground">
                      <tr><th className="px-2 py-1 text-left">Period</th><th className="px-2 py-1 text-right">EPS</th><th className="px-2 py-1 text-right">Analysts</th><th className="px-2 py-1 text-center">Dir</th><th className="px-2 py-1 text-right">Fetched</th></tr>
                    </thead>
                    <tbody>
                      {data!.estimateRevisions.map((r) => (
                        <tr key={r.id} className="border-t">
                          <td className="px-2 py-1">{r.period ?? "—"}</td>
                          <td className="px-2 py-1 text-right">{r.eps_estimate?.toFixed(2) ?? "—"}</td>
                          <td className="px-2 py-1 text-right">{r.analyst_count ?? "—"}</td>
                          <td className={cn("px-2 py-1 text-center", r.revision_direction === "up" ? "text-gain" : r.revision_direction === "down" ? "text-loss" : "text-muted-foreground")}>{r.revision_direction ?? "—"}</td>
                          <td className="px-2 py-1 text-right text-muted-foreground">{timeAgo(r.fetched_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No revision history yet</div>
              )}
            </section>

            <Separator />

            <section className="space-y-2">
              <SectionTitle>News</SectionTitle>
              <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                News feed lands in Phase 2 (News tab).
              </div>
            </section>

            <div className="flex justify-end pt-2">
              <Button variant="destructive" size="sm" onClick={remove}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove ticker
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</div>;
}

// Avoid unused-import warning when formatPct isn't referenced.
void formatPct;
