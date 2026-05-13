"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EventChip, MacroChip } from "./EventChip";
import type { CalendarEvent } from "@/app/api/earnings/calendar/route";
import type { MacroEvent } from "@/lib/macro-calendar";

interface Props {
  monthStart: Date;        // first day of month being displayed
  onChangeMonth: (d: Date) => void;
  events: CalendarEvent[];
  macro: MacroEvent[];
  onSelectEvent: (e: CalendarEvent) => void;
}

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function MonthGrid({ monthStart, onChangeMonth, events, macro, onSelectEvent }: Props) {
  // Build weeks (rows) starting Sunday for visual familiarity.
  const cells = useMemo(() => {
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const firstOfMonth = new Date(year, month, 1);
    const dow = firstOfMonth.getDay(); // 0=Sun
    const gridStart = new Date(year, month, 1 - dow);
    const out: Array<{ date: Date; iso: string; inMonth: boolean }> = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      out.push({
        date: d,
        iso: toIsoDate(d),
        inMonth: d.getMonth() === month,
      });
    }
    return out;
  }, [monthStart]);

  const eventsByDate = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => {
        const groupRank = (g: CalendarEvent["group"]) => (g === "mine" ? 0 : g === "mega" ? 1 : 2);
        return groupRank(a.group) - groupRank(b.group) || a.symbol.localeCompare(b.symbol);
      });
    }
    return m;
  }, [events]);

  const macroByDate = useMemo(() => {
    const m = new Map<string, MacroEvent[]>();
    for (const e of macro) {
      const arr = m.get(e.date) ?? [];
      arr.push(e);
      m.set(e.date, arr);
    }
    return m;
  }, [macro]);

  const monthLabel = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });
  const today = toIsoDate(new Date());

  return (
    <div className="flex h-full flex-col rounded-md border">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => onChangeMonth(addMonths(monthStart, -1))}>
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <div className="text-sm font-semibold uppercase tracking-wider">{monthLabel}</div>
        <Button size="sm" variant="ghost" onClick={() => onChangeMonth(addMonths(monthStart, 1))}>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
      <div className="grid grid-cols-7 border-b text-[10px] uppercase tracking-widest text-muted-foreground">
        {DAY_LABELS.map((d) => (
          <div key={d} className="px-2 py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid flex-1 auto-rows-fr grid-cols-7">
        {cells.map(({ date, iso, inMonth }) => {
          const evs = eventsByDate.get(iso) ?? [];
          const macros = macroByDate.get(iso) ?? [];
          const isToday = iso === today;
          const isWeekend = date.getDay() === 0 || date.getDay() === 6;
          const hasMine = evs.some((e) => e.group === "mine");
          const hasDoubleEvent = hasMine && macros.length > 0;
          return (
            <div
              key={iso}
              className={cn(
                "border-b border-r p-1 text-[10px]",
                !inMonth && "bg-muted/30 opacity-50",
                isWeekend && inMonth && "bg-muted/10",
                hasDoubleEvent && "ring-1 ring-inset ring-amber-500/40",
              )}
            >
              <div className="flex items-center justify-between">
                <span className={cn("font-mono", isToday && "rounded-sm bg-tier1 px-1 text-background")}>
                  {date.getDate()}
                </span>
                {hasDoubleEvent && (
                  <span className="text-[9px] font-semibold uppercase text-amber-500" title="Earnings + macro event same week">
                    DBL
                  </span>
                )}
              </div>
              <div className="mt-1 space-y-0.5">
                {evs.slice(0, 4).map((e) => (
                  <EventChip key={`${e.symbol}-${e.date}`} event={e} onClick={() => onSelectEvent(e)} compact />
                ))}
                {evs.length > 4 && (
                  <div className="text-[9px] text-muted-foreground">+{evs.length - 4} more</div>
                )}
                {macros.slice(0, 2).map((m, i) => (
                  <MacroChip key={`${m.date}-${i}`} kind={m.kind} label={m.label} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function toIsoDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}
