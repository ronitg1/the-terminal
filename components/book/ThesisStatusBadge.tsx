import { cn } from "@/lib/utils";
import type { ThesisStatus } from "@/lib/types/db";

const MAP: Record<ThesisStatus, { label: string; className: string }> = {
  intact:        { label: "INTACT",   className: "bg-gain/15 text-gain border-gain/40" },
  strengthened:  { label: "STRONG+",  className: "bg-tier1/15 text-tier1 border-tier1/40" },
  weakened:      { label: "WEAK",     className: "bg-amber-500/15 text-amber-500 border-amber-500/40" },
  broken:        { label: "BROKEN",   className: "bg-loss/15 text-loss border-loss/40" },
};

export function ThesisStatusBadge({ status }: { status: ThesisStatus | string | null | undefined }) {
  if (!status) return <span className="text-[10px] text-muted-foreground">—</span>;
  const entry = MAP[status as ThesisStatus];
  if (!entry) return <span className="text-[10px] text-muted-foreground">{status}</span>;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold tracking-wider",
        entry.className,
      )}
    >
      {entry.label}
    </span>
  );
}
