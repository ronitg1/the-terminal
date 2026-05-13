"use client";

import { useEffect, useState } from "react";
import { ExternalLink, Sparkles } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { cn, timeAgo } from "@/lib/utils";
import type { NewsItem } from "@/app/api/news/feed/route";

interface SummaryResult {
  summary: string[];
  relevance: "high" | "medium" | "low";
  relevanceReason: string;
  hadFullBody: boolean;
}

export function ArticleDetailSheet({
  article,
  open,
  onOpenChange,
}: {
  article: NewsItem | null;
  open: boolean;
  onOpenChange: (b: boolean) => void;
}) {
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSummary(null);
      setError(null);
    }
  }, [open, article]);

  async function summarize() {
    if (!article) return;
    setLoading(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/news/summarize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          url: article.url,
          title: article.title,
          description: article.description,
          relatedSymbol: article.relatedSymbol,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setSummary(j as SummaryResult);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const relColor =
    summary?.relevance === "high"
      ? "border-tier1/40 bg-tier1/10 text-tier1"
      : summary?.relevance === "low"
      ? "border-muted-foreground/40 bg-muted text-muted-foreground"
      : "border-amber-500/40 bg-amber-500/10 text-amber-500";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        {article && (
          <>
            <SheetHeader>
              <div className="flex items-baseline gap-2">
                {article.relatedSymbol && (
                  <span className="rounded-sm border bg-secondary px-1.5 py-0.5 font-mono text-xs font-semibold">
                    {article.relatedSymbol}
                  </span>
                )}
                <SheetTitle className="text-base leading-snug">{article.title}</SheetTitle>
              </div>
              <SheetDescription className="text-xs">
                {article.source ?? "unknown source"} · {timeAgo(article.publishedAt)}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 space-y-4">
              {article.description && (
                <p className="text-sm leading-relaxed text-muted-foreground">{article.description}</p>
              )}

              <div className="flex gap-2">
                <Button size="sm" onClick={summarize} disabled={loading}>
                  <Sparkles className={cn("mr-1 h-3 w-3", loading && "animate-pulse")} />
                  {loading ? "Summarizing…" : "AI summarize"}
                </Button>
                <a
                  href={article.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs hover:bg-accent"
                >
                  <ExternalLink className="h-3 w-3" /> Open article
                </a>
              </div>

              {error && <div className="rounded-md border border-loss/40 bg-loss/10 p-2 text-xs text-loss">{error}</div>}

              {summary && (
                <div className="space-y-3 rounded-md border bg-card p-3">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn(
                        "rounded-sm border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        relColor,
                      )}
                    >
                      {summary.relevance} relevance
                    </span>
                    {!summary.hadFullBody && (
                      <span className="text-[10px] text-muted-foreground">
                        (summarized from headline + description — full body not accessible)
                      </span>
                    )}
                  </div>
                  {summary.summary.length > 0 && (
                    <ul className="list-inside list-disc space-y-1 text-sm">
                      {summary.summary.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  )}
                  {summary.relevanceReason && (
                    <p className="text-xs text-muted-foreground">
                      <span className="font-semibold uppercase tracking-wider">Why it matters:</span>{" "}
                      {summary.relevanceReason}
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
