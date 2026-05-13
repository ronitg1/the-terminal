"use client";

import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JournalDay } from "@/app/api/journal/route";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function JournalCalendar({
  monthStart,
  onChangeMonth,
  days,
  selectedDate,
  onSelectDate,
}: {
  monthStart: Date;
  onChangeMonth: (d: Date) => void;
  days: JournalDay[];
  selectedDate: string;
  onSelectDate: (iso: string) => void;
}) {
  const dayMap = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  const cells = useMemo(() => {
    const year = monthStart.getFullYear();
    const month = monthStart.getMonth();
    const first = new Date(year, month, 1);
    const dow = first.getDay();
    const gridStart = new Date(year, month, 1 - dow);
    const out: Array<{ date: Date; iso: string; inMonth: boolean }> = [];
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      out.push({ date: d, iso: toIso(d), inMonth: d.getMonth() === month });
    }
    return out;
  }, [monthStart]);

  const todayIso = toIso(new Date());
  const monthLabel = monthStart.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-2 py-1.5">
        <Button size="sm" variant="ghost" onClick={() => onChangeMonth(addMonths(monthStart, -1))}>
          <ChevronLeft className="h-3.5 w-3.5" />
        </Button>
        <div className="text-xs font-semibold uppercase tracking-wider">{monthLabel}</div>
        <Button size="sm" variant="ghost" onClick={() => onChangeMonth(addMonths(monthStart, 1))}>
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
      <div className="grid grid-cols-7 border-b text-[9px] uppercase tracking-widest text-muted-foreground">
        {DAY_LABELS.map((d) => (
          <div key={d} className="px-1 py-1 text-center">
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {cells.map(({ date, iso, inMonth }) => {
          const day = dayMap.get(iso);
          const isToday = iso === todayIso;
          const isSelected = iso === selectedDate;
          const hasContent = day?.has_content;
          return (
            <button
              key={iso}
              onClick={() => onSelectDate(iso)}
              className={cn(
                "relative flex aspect-square flex-col items-center justify-center border border-transparent text-xs transition-colors hover:bg-accent",
                !inMonth && "opacity-30",
                isSelected && "border-tier1 bg-tier1/10",
              )}
            >
              <span
                className={cn(
                  "font-mono",
                  isToday && !isSelected && "rounded-sm bg-tier1 px-1 text-background",
                  isSelected && "font-semibold text-tier1",
                )}
              >
                {date.getDate()}
              </span>
              {hasContent && <span className="absolute bottom-1 h-1 w-1 rounded-full bg-tier1" />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function addMonths(d: Date, delta: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + delta, 1);
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
