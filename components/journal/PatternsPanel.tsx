"use client";

import { useState } from "react";
import { LineChart, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Mistake {
  pattern: string;
  evidence: string;
  fix: string;
}

interface PatternReport {
  headline: string;
  strengths: string[];
  mistakes: Mistake[];
  byTier: string;
  byStructure: string;
  byHoldingPeriod: string;
  emotional: string;
  watchlist: string[];
  counts: { journal: number; trades: number; closedTrades: number };
}

export function PatternsPanel() {
  const [report, setReport] = useState<PatternReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const res = await fetch("/api/journal/patterns", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : `HTTP ${res.status}`);
      setReport(j as PatternReport);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-card p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <LineChart className="h-3.5 w-3.5 text-tier1" />
          <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Pattern analysis
          </div>
        </div>
        <Button size="sm" onClick={run} disabled={loading}>
          <Sparkles className={cn("mr-1 h-3 w-3", loading && "animate-pulse")} />
          {loading ? "Analyzing…" : report ? "Re-run" : "Review my patterns"}
        </Button>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Coaching pass over the last 90d of journal entries + tracked AI trade ideas. Flags repeated habits — both productive and counter-productive.
      </p>

      {error && (
        <div className="rounded-md border border-loss/40 bg-loss/10 p-2 text-xs text-loss">{error}</div>
      )}

      {report && (
        <div className="space-y-3 pt-1">
          <div className="text-[10px] text-muted-foreground">
            Window: {report.counts.journal} entries · {report.counts.trades} ideas ({report.counts.closedTrades} closed)
          </div>

          {report.headline && (
            <p className="text-sm font-medium leading-snug">{report.headline}</p>
          )}

          {report.strengths.length > 0 && (
            <Section title="Working" tone="gain">
              <ul className="list-inside list-disc space-y-1 text-xs">
                {report.strengths.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ul>
            </Section>
          )}

          {report.mistakes.length > 0 && (
            <Section title="Mistakes to fix" tone="loss">
              <div className="space-y-2 text-xs">
                {report.mistakes.map((m, i) => (
                  <div key={i} className="rounded-md border border-loss/20 bg-loss/5 p-2">
                    <div className="font-semibold">{m.pattern}</div>
                    {m.evidence && (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        <span className="font-semibold uppercase tracking-wider">Evidence:</span> {m.evidence}
                      </div>
                    )}
                    {m.fix && (
                      <div className="mt-1 text-[11px]">
                        <span className="font-semibold uppercase tracking-wider text-tier1">Fix:</span> {m.fix}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {report.byTier && <Para title="By tier" body={report.byTier} />}
          {report.byStructure && <Para title="By structure" body={report.byStructure} />}
          {report.byHoldingPeriod && <Para title="By holding period" body={report.byHoldingPeriod} />}
          {report.emotional && <Para title="Process / emotional" body={report.emotional} />}

          {report.watchlist.length > 0 && (
            <Section title="Watch next 4 weeks" tone="info">
              <ul className="list-inside list-disc space-y-1 text-xs">
                {report.watchlist.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone: "gain" | "loss" | "info";
  children: React.ReactNode;
}) {
  return (
    <div>
      <div
        className={cn(
          "mb-1 text-[10px] font-semibold uppercase tracking-wider",
          tone === "gain" && "text-gain",
          tone === "loss" && "text-loss",
          tone === "info" && "text-muted-foreground",
        )}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function Para({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </div>
      <p className="text-xs leading-relaxed">{body}</p>
    </div>
  );
}
