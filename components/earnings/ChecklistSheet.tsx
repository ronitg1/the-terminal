"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { computeSizing, type ConvictionTier, type Structure } from "@/lib/earnings/sizing";
import { cn, formatPct, timeAgo } from "@/lib/utils";
import type { CalendarEvent } from "@/app/api/earnings/calendar/route";

interface Checklist {
  consensus_key_metric?: string;
  iv_vs_history?: string;
  short_interest_dynamics?: string;
  variant_view?: string;
  sector_fund_flow?: string;
  structure?: Structure | "";
  entry_plan?: string;
  stop?: string;
  trim_target?: string;
}

const QUESTIONS: Array<{ key: keyof Checklist; q: string; long?: boolean }> = [
  { key: "consensus_key_metric", q: "What is consensus expecting for the KEY metric this quarter (not just EPS)?" },
  { key: "iv_vs_history", q: "What is the implied move? Cheap or expensive vs. last 4 cycles?" },
  { key: "short_interest_dynamics", q: "What is short interest / days-to-cover? Squeeze potential?" },
  { key: "variant_view", q: "What is my variant view vs. consensus?", long: true },
  { key: "sector_fund_flow", q: "What is the sector fund flow backdrop?" },
  { key: "entry_plan", q: "What is my entry plan (size, timing)?", long: true },
  { key: "stop", q: "What is my stop?" },
  { key: "trim_target", q: "What is my trim target on a beat?" },
];

const STRUCTURES: Array<{ value: Structure; label: string }> = [
  { value: "long_stock", label: "Long stock" },
  { value: "short_stock", label: "Short stock" },
  { value: "long_call", label: "Long call" },
  { value: "long_put", label: "Long put" },
  { value: "long_straddle", label: "Long straddle" },
  { value: "bull_call_spread", label: "Bull call spread" },
  { value: "bear_put_spread", label: "Bear put spread" },
];

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function ChecklistSheet({
  event,
  open,
  onOpenChange,
  onSaved,
}: {
  event: CalendarEvent | null;
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onSaved: () => void;
}) {
  const [checklist, setChecklist] = useState<Checklist>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const { data: settingsData } = useSWR<{ settings: { bookSizeUsd: number } }>("/api/settings", fetcher);
  const settingsBookSize = settingsData?.settings?.bookSizeUsd;
  const [bookSizeUsd, setBookSizeUsd] = useState(200_000);
  // Pull the user's configured book size from Settings when it arrives.
  useEffect(() => {
    if (typeof settingsBookSize === "number" && settingsBookSize > 0) {
      setBookSizeUsd(settingsBookSize);
    }
  }, [settingsBookSize]);
  const [stopPct, setStopPct] = useState<string>("8");
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load any persisted checklist when the sheet opens.
  useEffect(() => {
    if (!open || !event) return;
    setChecklist({});
    setSavedAt(null);
    fetch(`/api/earnings/event?symbol=${encodeURIComponent(event.symbol)}&report_date=${event.date}`)
      .then((r) => r.json())
      .then((j) => {
        const cd: Checklist | null = j?.event?.checklist_data ?? null;
        if (cd && typeof cd === "object") setChecklist(cd);
      })
      .catch(() => {});
  }, [open, event]);

  function schedulePatch(next: Checklist) {
    if (!event) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch("/api/earnings/event", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: event.symbol,
          report_date: event.date,
          checklist_data: next,
          implied_move_pct: event.impliedMovePct ?? undefined,
          eps_estimate: event.epsEstimate ?? undefined,
          rev_estimate: event.revenueEstimate ?? undefined,
          timing: event.timing,
        }),
      });
      if (res.ok) {
        setSavedAt(new Date().toISOString());
        onSaved();
      }
    }, 500);
  }

  function update<K extends keyof Checklist>(key: K, value: Checklist[K]) {
    setChecklist((c) => {
      const next = { ...c, [key]: value };
      schedulePatch(next);
      return next;
    });
  }

  const tier: ConvictionTier = (event?.tier as ConvictionTier) ?? 3;
  const structure = (checklist.structure || "long_stock") as Structure;
  const stopPctNum = Number.parseFloat(stopPct);

  const sizing = useMemo(
    () =>
      computeSizing({
        bookSizeUsd,
        tier,
        impliedMovePct: event?.impliedMovePct ?? null,
        stopPct: Number.isFinite(stopPctNum) ? stopPctNum : null,
        structure,
      }),
    [bookSizeUsd, tier, event?.impliedMovePct, stopPctNum, structure],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {event && (
          <>
            <SheetHeader>
              <div className="flex items-baseline gap-3">
                <SheetTitle className="text-xl">{event.symbol}</SheetTitle>
                <span className="text-xs text-muted-foreground">
                  reports {event.date}
                  {event.timing && ` · ${event.timing}`}
                  {event.daysUntil != null && ` · ${event.daysUntil}d away`}
                </span>
              </div>
              <SheetDescription className="text-xs">
                {event.name}
                {event.impliedMovePct != null && (
                  <span className="ml-2">IV move {formatPct(event.impliedMovePct, 1)}</span>
                )}
                {event.siPct != null && <span className="ml-2">SI {event.siPct.toFixed(1)}%</span>}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-5">
              <section>
                <div className="mb-2 flex items-baseline justify-between">
                  <SectionTitle>Pre-earnings checklist</SectionTitle>
                  {savedAt && <span className="text-[10px] text-muted-foreground">saved {timeAgo(savedAt)}</span>}
                </div>
                <div className="space-y-3">
                  {QUESTIONS.map((q) => (
                    <div key={q.key} className="space-y-1">
                      <Label className="text-[11px] leading-snug text-foreground">{q.q}</Label>
                      {q.long ? (
                        <Textarea
                          value={(checklist[q.key] as string) ?? ""}
                          onChange={(e) => update(q.key, e.target.value)}
                          rows={2}
                          className="text-xs"
                        />
                      ) : (
                        <Input
                          value={(checklist[q.key] as string) ?? ""}
                          onChange={(e) => update(q.key, e.target.value)}
                          className="text-xs"
                        />
                      )}
                    </div>
                  ))}
                  <div className="space-y-1">
                    <Label className="text-[11px] leading-snug">What is my intended structure?</Label>
                    <Select
                      value={(checklist.structure as string) || "long_stock"}
                      onValueChange={(v) => update("structure", v as Structure)}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STRUCTURES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </section>

              <Separator />

              <section>
                <SectionTitle>Position sizing calculator</SectionTitle>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Book size</Label>
                    <div className="relative">
                      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                      <Input
                        type="number"
                        value={bookSizeUsd}
                        onChange={(e) => setBookSizeUsd(Math.max(0, Number(e.target.value) || 0))}
                        className="pl-5 text-xs"
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Conviction tier</Label>
                    <Input value={`T${tier}`} disabled className="text-xs" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Stop %</Label>
                    <Input
                      type="number"
                      value={stopPct}
                      onChange={(e) => setStopPct(e.target.value)}
                      className="text-xs"
                    />
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 rounded-md border bg-secondary/40 p-3 text-xs">
                  <Metric label="Position size" value={`$${Math.round(sizing.positionUsd).toLocaleString()}`} />
                  <Metric label="% of book" value={`${(sizing.positionPctOfBook * 100).toFixed(2)}%`} />
                  {sizing.maxPremiumUsd != null && (
                    <Metric label="Max premium spend" value={`$${Math.round(sizing.maxPremiumUsd).toLocaleString()}`} />
                  )}
                  <Metric
                    label="Effective $ at risk"
                    value={`$${Math.round(sizing.effectiveRiskUsd).toLocaleString()} (${(sizing.effectiveRiskPctOfBook * 100).toFixed(2)}%)`}
                    color={sizing.effectiveRiskPctOfBook > 0.005 ? "amber" : undefined}
                  />
                </div>
                <ul className="mt-2 list-inside list-disc space-y-1 text-[11px] text-muted-foreground">
                  {sizing.notes.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              </section>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color?: "amber" }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 font-mono font-semibold tabular-nums", color === "amber" && "text-amber-500")}>
        {value}
      </div>
    </div>
  );
}

// silence unused import warning when fetcher isn't used inline
void fetcher;
