import { AlertTriangle } from "lucide-react";
import { cn, timeAgo } from "@/lib/utils";

export function StaleDataBadge({ fetchedAt, label, className }: { fetchedAt: string | null; label?: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-500",
        className,
      )}
      title={fetchedAt ? `Last good: ${new Date(fetchedAt).toLocaleString()}` : undefined}
    >
      <AlertTriangle className="h-3 w-3" />
      {label ?? "STALE"}{fetchedAt ? ` · ${timeAgo(fetchedAt)}` : ""}
    </span>
  );
}
