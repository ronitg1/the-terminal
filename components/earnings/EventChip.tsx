import { CheckCircle2, ClipboardList } from "lucide-react";
import { TierBadge } from "@/components/book/TierBadge";
import { cn, formatPct } from "@/lib/utils";
import type { CalendarEvent } from "@/app/api/earnings/calendar/route";
import type { TickerTier } from "@/lib/types/db";

export function EventChip({
  event,
  onClick,
  compact = false,
}: {
  event: CalendarEvent;
  onClick: () => void;
  compact?: boolean;
}) {
  const isMine = event.group === "mine";
  const isMega = event.group === "mega";

  const borderColor: Record<number, string> = {
    1: "border-l-tier1",
    2: "border-l-tier2",
    3: "border-l-tier3",
  };

  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-1.5 rounded-sm border bg-card px-1.5 py-1 text-left text-xs transition-colors hover:bg-accent",
        isMine && event.tier && `border-l-2 ${borderColor[event.tier]}`,
        isMega && "border-l-2 border-l-amber-500/70",
        !isMine && !isMega && "opacity-70",
        compact && "py-0.5",
      )}
    >
      {isMine && event.tier && <TierBadge tier={event.tier as TickerTier} />}
      {isMega && (
        <span className="rounded-sm border border-amber-500/40 bg-amber-500/10 px-1 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-500">
          MKT
        </span>
      )}
      <span className={cn("font-semibold tabular-nums", isMine && "text-sm")}>{event.symbol}</span>
      {event.timing && (
        <span className="rounded-sm border bg-muted px-1 py-0 text-[9px] uppercase text-muted-foreground">
          {event.timing}
        </span>
      )}
      {!compact && isMine && event.impliedMovePct != null && (
        <span className="ml-auto text-[10px] text-muted-foreground">{formatPct(event.impliedMovePct, 1)}</span>
      )}
      {isMine && event.hasChecklist && (
        <ClipboardList className="ml-auto h-3 w-3 text-tier1" aria-label="Has checklist" />
      )}
      {isMine && event.hasDebrief && (
        <CheckCircle2 className="h-3 w-3 text-gain" aria-label="Has debrief" />
      )}
    </button>
  );
}

export function MacroChip({ label, kind }: { label: string; kind: string }) {
  return (
    <div className="flex items-center gap-1.5 rounded-sm border border-dashed bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
      <span className="font-semibold uppercase tracking-wider">{kind}</span>
      <span className="truncate">{label}</span>
    </div>
  );
}
