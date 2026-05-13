"use client";

import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Sun, Sunrise, Sunset } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TierBadge } from "@/components/book/TierBadge";
import { RevisionArrow } from "@/components/book/RevisionArrow";
import { cn, formatPct } from "@/lib/utils";
import type { CalendarEvent } from "@/app/api/earnings/calendar/route";
import type { MacroEvent } from "@/lib/macro-calendar";
import type { TickerTier } from "@/lib/types/db";

interface Props {
  events: CalendarEvent[];
  macro: MacroEvent[];
  onSelectEvent: (e: CalendarEvent) => void;
}

type TimingBucket = "BH" | "midday" | "AH";

export function WeekList({ events, macro, onSelectEvent }: Props) {
  // Anchor: Monday of the current week, then nav with prev/next.
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [includeWeekend, setIncludeWeekend] = useState(false);

  const days = useMemo(() => {
    const n = includeWeekend ? 7 : 5;
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
  }, [weekStart, includeWeekend]);

  const eventsByDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const rank = (g: CalendarEvent["group"]) => (g === "mine" ? 0 : g === "mega" ? 1 : 2);
        return rank(a.group) - rank(b.group) || a.symbol.localeCompare(b.symbol);
      });
    }
    return m;
  }, [events]);

  const macroByDay = useMemo(() => {
    const m = new Map<string, MacroEvent[]>();
    for (const e of macro) {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    }
    return m;
  }, [macro]);

  const todayIso = toIso(new Date());
  const weekLabel = `${formatDay(days[0])} – ${formatDay(days[days.length - 1])}`;

  return (
    <div className="flex h-full flex-col rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => setWeekStart(addDays(weekStart, -7))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3">
          <div className="text-sm font-semibold uppercase tracking-wider">{weekLabel}</div>
          <button
            onClick={() => setWeekStart(mondayOf(new Date()))}
            className="rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-wider text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            This week
          </button>
          <button
            onClick={() => setIncludeWeekend((v) => !v)}
            className={cn(
              "rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-wider transition-colors",
              includeWeekend ? "border-foreground bg-foreground text-background" : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {includeWeekend ? "7-day" : "5-day"}
          </button>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setWeekStart(addDays(weekStart, 7))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      <div
        className="grid flex-1 min-h-0 divide-x"
        style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {days.map((d) => {
          const iso = toIso(d);
          const isToday = iso === todayIso;
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          const evs = eventsByDay.get(iso) ?? [];
          const macros = macroByDay.get(iso) ?? [];
          const buckets = bucketByTiming(evs);
          return (
            <div key={iso} className={cn("flex min-h-0 flex-col", isWeekend && "bg-muted/10")}>
              <div
                className={cn(
                  "border-b px-2 py-1.5 text-center",
                  isToday && "bg-tier1/10",
                )}
              >
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {d.toLocaleDateString(undefined, { weekday: "short" })}
                </div>
                <div className={cn("font-mono text-sm font-semibold tabular-nums", isToday && "text-tier1")}>
                  {d.getDate()}
                </div>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto p-1.5">
                {macros.map((m, i) => (
                  <div
                    key={`macro-${i}`}
                    className="rounded-sm border border-dashed bg-muted/40 px-1.5 py-1 text-[10px] text-muted-foreground"
                  >
                    <div className="font-semibold uppercase tracking-wider">{m.kind}</div>
                    <div className="truncate">{m.label}</div>
                  </div>
                ))}

                <TimingSection
                  icon={<Sunrise className="h-3 w-3" />}
                  label="Before open"
                  events={buckets.BH}
                  onSelect={onSelectEvent}
                />
                <TimingSection
                  icon={<Sun className="h-3 w-3" />}
                  label="During / unclassified"
                  events={buckets.midday}
                  onSelect={onSelectEvent}
                />
                <TimingSection
                  icon={<Sunset className="h-3 w-3" />}
                  label="After close"
                  events={buckets.AH}
                  onSelect={onSelectEvent}
                />

                {evs.length === 0 && macros.length === 0 && (
                  <div className="pt-4 text-center text-[10px] text-muted-foreground/60">no events</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TimingSection({
  icon,
  label,
  events,
  onSelect,
}: {
  icon: React.ReactNode;
  label: string;
  events: CalendarEvent[];
  onSelect: (e: CalendarEvent) => void;
}) {
  if (events.length === 0) return null;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-widest text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="space-y-1">
        {events.map((e) => (
          <EventCalendarCard key={`${e.symbol}-${e.date}`} event={e} onClick={() => onSelect(e)} />
        ))}
      </div>
    </div>
  );
}

function EventCalendarCard({ event, onClick }: { event: CalendarEvent; onClick: () => void }) {
  const isMine = event.group === "mine";
  const isMega = event.group === "mega";
  const tierBorder: Record<number, string> = {
    1: "border-l-tier1",
    2: "border-l-tier2",
    3: "border-l-tier3",
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full rounded-sm border bg-card px-1.5 py-1 text-left transition-colors hover:bg-accent",
        isMine && event.tier && `border-l-2 ${tierBorder[event.tier]}`,
        isMega && "border-l-2 border-l-amber-500/70",
        !isMine && !isMega && "opacity-70",
      )}
    >
      <div className="flex items-center gap-1">
        {isMine && event.tier && <TierBadge tier={event.tier as TickerTier} />}
        {isMega && (
          <span className="inline-flex h-4 items-center rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 text-[9px] font-bold uppercase tracking-wider text-amber-500">
            MKT
          </span>
        )}
        <span className={cn("font-semibold tabular-nums", isMine ? "text-sm" : "text-xs")}>
          {event.symbol}
        </span>
        {event.timing && (
          <span className="rounded-sm border bg-muted px-1 text-[9px] uppercase text-muted-foreground">
            {event.timing}
          </span>
        )}
        {isMine && event.revisionDirection && (
          <span className="ml-auto"><RevisionArrow dir={event.revisionDirection} /></span>
        )}
      </div>

      {(isMine || isMega) && event.name && (
        <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{event.name}</div>
      )}

      {isMine && (
        <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted-foreground">
          {event.epsEstimate != null && (
            <span>
              <span className="opacity-70">EPS est</span>{" "}
              <span className="font-mono text-foreground">{event.epsEstimate.toFixed(2)}</span>
            </span>
          )}
          {event.impliedMovePct != null && (
            <span>
              <span className="opacity-70">IV</span>{" "}
              <span className="font-mono text-foreground">{formatPct(event.impliedMovePct, 1)}</span>
            </span>
          )}
          {event.siPct != null && (
            <span>
              <span className="opacity-70">SI</span>{" "}
              <span className="font-mono text-foreground">{event.siPct.toFixed(1)}%</span>
            </span>
          )}
        </div>
      )}

      {isMine && (event.hasChecklist || event.hasDebrief) && (
        <div className="mt-1 flex gap-1 text-[9px]">
          {event.hasChecklist && (
            <span className="rounded-sm border border-tier1/40 bg-tier1/10 px-1 uppercase tracking-wider text-tier1">
              Checklist
            </span>
          )}
          {event.hasDebrief && (
            <span className="rounded-sm border border-gain/40 bg-gain/10 px-1 uppercase tracking-wider text-gain">
              Debrief
            </span>
          )}
        </div>
      )}
    </button>
  );
}

function bucketByTiming(events: CalendarEvent[]): Record<TimingBucket, CalendarEvent[]> {
  const out: Record<TimingBucket, CalendarEvent[]> = { BH: [], midday: [], AH: [] };
  for (const e of events) {
    if (e.timing === "BH") out.BH.push(e);
    else if (e.timing === "AH") out.AH.push(e);
    else out.midday.push(e);
  }
  return out;
}

function mondayOf(d: Date): Date {
  const out = new Date(d);
  const dow = out.getDay(); // 0=Sun..6=Sat
  const offset = dow === 0 ? -6 : 1 - dow; // shift to Monday
  out.setDate(out.getDate() + offset);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatDay(d: Date): string {
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
