"use client";

import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import type { CalendarEvent } from "@/app/api/earnings/calendar/route";

type ThesisOutcome = "confirmed" | "partial" | "broken" | "";

interface Debrief {
  actual_eps?: string;
  actual_rev?: string;
  reaction_pct?: string;
  thesis_outcome?: ThesisOutcome;
  management_surprise?: string;
  do_differently?: string;
  lessons?: string;
}

export function DebriefSheet({
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
  const [debrief, setDebrief] = useState<Debrief>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [thesisRerunning, setThesisRerunning] = useState(false);
  const [thesisRerunStatus, setThesisRerunStatus] = useState<string | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open || !event) return;
    setDebrief({});
    setSavedAt(null);
    setThesisRerunStatus(null);
    fetch(`/api/earnings/event?symbol=${encodeURIComponent(event.symbol)}&report_date=${event.date}`)
      .then((r) => r.json())
      .then((j) => {
        const dd: Debrief | null = j?.event?.debrief_data ?? null;
        if (dd && typeof dd === "object") setDebrief(dd);
      })
      .catch(() => {});
  }, [open, event]);

  function schedulePatch(next: Debrief) {
    if (!event) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const res = await fetch("/api/earnings/event", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: event.symbol,
          report_date: event.date,
          debrief_data: next,
          actual_eps: parseFloatOrNull(next.actual_eps),
          actual_rev: parseFloatOrNull(next.actual_rev),
          stock_reaction_pct: parseFloatOrNull(next.reaction_pct),
        }),
      });
      if (res.ok) {
        setSavedAt(new Date().toISOString());
        onSaved();
      }
    }, 500);
  }

  function update<K extends keyof Debrief>(key: K, value: Debrief[K]) {
    setDebrief((d) => {
      const next = { ...d, [key]: value };
      schedulePatch(next);
      return next;
    });
  }

  async function rerunThesis() {
    if (!event) return;
    setThesisRerunning(true);
    setThesisRerunStatus("Running multi-agent thesis with debrief context…");
    try {
      const res = await fetch(`/api/agent/run/${encodeURIComponent(event.symbol)}`, { method: "POST" });
      if (res.ok) {
        setThesisRerunStatus("Thesis updated. Open the AI Research tab to see the new snapshot.");
      } else {
        const j = await res.json().catch(() => ({}));
        setThesisRerunStatus(`Failed: ${j.error ?? `HTTP ${res.status}`}`);
      }
    } catch (err) {
      setThesisRerunStatus(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setThesisRerunning(false);
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {event && (
          <>
            <SheetHeader>
              <div className="flex items-baseline gap-3">
                <SheetTitle className="text-xl">{event.symbol} debrief</SheetTitle>
                <span className="text-xs text-muted-foreground">
                  reported {event.date}
                  {event.timing && ` · ${event.timing}`}
                </span>
              </div>
              <SheetDescription className="text-xs">
                {event.name}
                {event.epsEstimate != null && <span className="ml-2">EPS est {event.epsEstimate.toFixed(2)}</span>}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {savedAt && (
                <div className="text-[10px] text-muted-foreground">saved {timeAgo(savedAt)}</div>
              )}

              <div className="grid grid-cols-3 gap-2">
                <Field label="Actual EPS">
                  <Input
                    type="number"
                    step="0.01"
                    value={debrief.actual_eps ?? ""}
                    onChange={(e) => update("actual_eps", e.target.value)}
                    className="text-xs"
                  />
                </Field>
                <Field label="Actual Rev ($)">
                  <Input
                    type="number"
                    value={debrief.actual_rev ?? ""}
                    onChange={(e) => update("actual_rev", e.target.value)}
                    className="text-xs"
                    placeholder="e.g. 1200000000"
                  />
                </Field>
                <Field label="Day-of reaction %">
                  <Input
                    type="number"
                    step="0.1"
                    value={debrief.reaction_pct ?? ""}
                    onChange={(e) => update("reaction_pct", e.target.value)}
                    className="text-xs"
                  />
                </Field>
              </div>

              <Field label="Thesis outcome">
                <Select
                  value={debrief.thesis_outcome || ""}
                  onValueChange={(v) => update("thesis_outcome", v as ThesisOutcome)}
                >
                  <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Select…" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="confirmed">Confirmed</SelectItem>
                    <SelectItem value="partial">Partially confirmed</SelectItem>
                    <SelectItem value="broken">Broken</SelectItem>
                  </SelectContent>
                </Select>
              </Field>

              <Field label="What did management say that surprised you?">
                <Textarea
                  rows={3}
                  value={debrief.management_surprise ?? ""}
                  onChange={(e) => update("management_surprise", e.target.value)}
                  className="text-xs"
                />
              </Field>

              <Field label="What would you do differently on the trade?">
                <Textarea
                  rows={3}
                  value={debrief.do_differently ?? ""}
                  onChange={(e) => update("do_differently", e.target.value)}
                  className="text-xs"
                />
              </Field>

              <Field label="Lessons learned">
                <Textarea
                  rows={3}
                  value={debrief.lessons ?? ""}
                  onChange={(e) => update("lessons", e.target.value)}
                  className="text-xs"
                />
              </Field>

              <Separator />

              <div className="space-y-2">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Post-debrief
                </div>
                <p className="text-xs text-muted-foreground">
                  Run a fresh multi-agent thesis on {event.symbol} now that you have the actual report — the AI will incorporate the new information and re-score conviction.
                </p>
                <Button size="sm" onClick={rerunThesis} disabled={thesisRerunning}>
                  <Sparkles className={cn("mr-1 h-3 w-3", thesisRerunning && "animate-pulse")} />
                  {thesisRerunning ? "Running…" : "Re-run thesis"}
                </Button>
                {thesisRerunStatus && (
                  <div className="text-[11px] text-muted-foreground">{thesisRerunStatus}</div>
                )}
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function parseFloatOrNull(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}
