import { ArrowRight } from "lucide-react";
import { ThesisStatusBadge } from "@/components/book/ThesisStatusBadge";
import { timeAgo } from "@/lib/utils";
import type { FeedStatusChange } from "@/app/api/agent/feed/route";

export function StatusChangeFeed({ changes }: { changes: FeedStatusChange[] }) {
  return (
    <div className="rounded-md border bg-card">
      <div className="border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Status change log
      </div>
      {changes.length === 0 ? (
        <div className="p-4 text-xs text-muted-foreground">
          No status changes yet — runs accrue here as the agent re-evaluates each ticker.
        </div>
      ) : (
        <ul className="divide-y">
          {changes.map((c, i) => (
            <li key={`${c.symbol}-${c.at}-${i}`} className="flex items-center justify-between gap-2 px-3 py-2 text-xs">
              <div className="flex items-center gap-2">
                <span className="w-12 font-semibold tabular-nums">{c.symbol}</span>
                <ThesisStatusBadge status={c.from} />
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <ThesisStatusBadge status={c.to} />
              </div>
              <div className="text-muted-foreground">
                conv {c.conviction ?? "—"}/10 · {timeAgo(c.at)}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
