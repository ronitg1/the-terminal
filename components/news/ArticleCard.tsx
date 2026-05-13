import { cn, timeAgo } from "@/lib/utils";
import type { NewsItem } from "@/app/api/news/feed/route";

export function ArticleCard({
  article,
  onClick,
  compact = false,
}: {
  article: NewsItem;
  onClick: () => void;
  compact?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "block w-full rounded-md border bg-card p-2 text-left text-xs transition-colors hover:bg-accent",
        compact && "p-1.5",
      )}
    >
      <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
        {article.relatedSymbol && (
          <span className="rounded-sm border bg-secondary px-1 py-0 font-mono font-semibold text-foreground">
            {article.relatedSymbol}
          </span>
        )}
        <span className="truncate">{article.source ?? "?"}</span>
        <span className="ml-auto">{timeAgo(article.publishedAt)}</span>
      </div>
      <div className={cn("mt-1 line-clamp-3 font-medium leading-snug text-foreground", compact && "line-clamp-2")}>
        {article.title}
      </div>
      {!compact && article.description && (
        <div className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{article.description}</div>
      )}
    </button>
  );
}
