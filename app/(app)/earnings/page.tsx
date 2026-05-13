"use client";

import { useMemo, useState } from "react";
import useSWR from "swr";
import { CalendarDays, List, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { MonthGrid } from "@/components/earnings/MonthGrid";
import { WeekList } from "@/components/earnings/WeekList";
import { ChecklistSheet } from "@/components/earnings/ChecklistSheet";
import { DebriefSheet } from "@/components/earnings/DebriefSheet";
import { cn } from "@/lib/utils";
import type { CalendarResponse, CalendarEvent } from "@/app/api/earnings/calendar/route";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function EarningsPage() {
  const [view, setView] = useState<"month" | "week">("week");
  const [monthStart, setMonthStart] = useState(() => firstOfMonth(new Date()));
  const [selectedChecklist, setSelectedChecklist] = useState<CalendarEvent | null>(null);
  const [selectedDebrief, setSelectedDebrief] = useState<CalendarEvent | null>(null);

  // Fetch a 90-day window starting from a month before the displayed month so the
  // grid has data both when looking at the current view and when paging.
  const { from, to } = useMemo(() => {
    const f = new Date(monthStart.getFullYear(), monthStart.getMonth() - 1, 1);
    const t = new Date(monthStart.getFullYear(), monthStart.getMonth() + 2, 0);
    return { from: toIso(f), to: toIso(t) };
  }, [monthStart]);

  const { data, mutate, isLoading } = useSWR<CalendarResponse>(
    `/api/earnings/calendar?from=${from}&to=${to}`,
    fetcher,
    { revalidateOnFocus: true, refreshInterval: 0 },
  );

  const events = data?.events ?? [];
  const macro = data?.macro ?? [];

  // Past my-name events that don't have a debrief yet → banner.
  const pendingDebriefs = useMemo(() => {
    const todayIso = toIso(new Date());
    return events
      .filter((e) => e.group === "mine" && e.date < todayIso && !e.hasDebrief)
      .sort((a, b) => (a.date > b.date ? -1 : 1)); // most recent first
  }, [events]);

  function handleEventClick(e: CalendarEvent) {
    if (e.group !== "mine") return; // only my names get a sidebar
    const todayIso = toIso(new Date());
    if (e.date < todayIso) {
      setSelectedDebrief(e);
    } else {
      setSelectedChecklist(e);
    }
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wider">Earnings calendar</div>
          <div className="text-[10px] text-muted-foreground">
            Your names highlighted by tier. Mega caps tagged MKT. Macro overlays ghosted gray.
          </div>
        </div>
        <div className="flex items-center gap-1 rounded-md border bg-card p-0.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setView("week")}
            className={cn(view === "week" && "bg-accent text-foreground")}
          >
            <List className="mr-1 h-3 w-3" /> This week
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setView("month")}
            className={cn(view === "month" && "bg-accent text-foreground")}
          >
            <CalendarDays className="mr-1 h-3 w-3" /> Month
          </Button>
        </div>
      </div>

      {pendingDebriefs.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <div className="flex items-center justify-between">
            <div>
              <span className="font-semibold uppercase tracking-wider text-amber-500">
                {pendingDebriefs.length === 1
                  ? `${pendingDebriefs[0].symbol} reported`
                  : `${pendingDebriefs.length} reports awaiting debrief`}
              </span>
              <span className="ml-2 text-muted-foreground">
                — log the debrief while details are fresh. Feeds back into the agent's next thesis.
              </span>
            </div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {pendingDebriefs.slice(0, 6).map((e) => (
              <button
                key={`${e.symbol}-${e.date}`}
                onClick={() => setSelectedDebrief(e)}
                className="inline-flex items-center gap-1.5 rounded-sm border border-amber-500/40 bg-card px-2 py-1 hover:bg-amber-500/10"
              >
                <span className="font-semibold">{e.symbol}</span>
                <span className="text-muted-foreground">{e.date}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <ErrorBoundary label="Earnings calendar">
        <div className="flex-1 overflow-hidden">
          {isLoading && !data ? (
            <div className="rounded-md border p-8 text-center text-xs text-muted-foreground">Loading earnings calendar…</div>
          ) : view === "month" ? (
            <MonthGrid
              monthStart={monthStart}
              onChangeMonth={setMonthStart}
              events={events}
              macro={macro}
              onSelectEvent={handleEventClick}
            />
          ) : (
            <div className="overflow-y-auto">
              <WeekList events={events} macro={macro} onSelectEvent={handleEventClick} />
            </div>
          )}
        </div>
      </ErrorBoundary>

      <ChecklistSheet
        event={selectedChecklist}
        open={selectedChecklist !== null}
        onOpenChange={(b) => !b && setSelectedChecklist(null)}
        onSaved={() => mutate()}
      />
      <DebriefSheet
        event={selectedDebrief}
        open={selectedDebrief !== null}
        onOpenChange={(b) => !b && setSelectedDebrief(null)}
        onSaved={() => mutate()}
      />
    </div>
  );
}

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Suppress unused-import warning if X icon isn't referenced.
void X;
