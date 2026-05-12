"use client";

import { useState } from "react";
import useSWR from "swr";
import { Play, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { ThesisCard } from "@/components/ai-research/ThesisCard";
import { StatusChangeFeed } from "@/components/ai-research/StatusChangeFeed";
import { ChatPanel } from "@/components/ai-research/ChatPanel";
import { TradeIdeaPanel } from "@/components/ai-research/TradeIdeaPanel";
import { BudgetIndicator } from "@/components/ai-research/BudgetIndicator";
import type { FeedThesisCard, FeedStatusChange } from "@/app/api/agent/feed/route";

interface FeedResp {
  cards: FeedThesisCard[];
  changes: FeedStatusChange[];
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function AIResearchPage() {
  const { data, mutate, isLoading } = useSWR<FeedResp>("/api/agent/feed", fetcher, {
    refreshInterval: 0,
    revalidateOnFocus: true,
  });
  const [runningAll, setRunningAll] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  async function runAll() {
    setRunningAll(true);
    setRunError(null);
    try {
      const res = await fetch("/api/agent/run-all?tier=1", { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      mutate();
    } catch (err) {
      setRunError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunningAll(false);
    }
  }

  const cards = data?.cards ?? [];
  const changes = data?.changes ?? [];

  return (
    <div className="grid h-[calc(100vh-7rem)] grid-cols-1 gap-4 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-4 overflow-y-auto">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold uppercase tracking-wider">T1 Thesis snapshots</div>
            <div className="text-[10px] text-muted-foreground">
              Agent runs every 2h on weekdays 9am-6pm ET. Run any name on-demand below.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <BudgetIndicator />
            <Button size="sm" variant="outline" onClick={() => mutate()} disabled={isLoading}>
              <RotateCw className="mr-1 h-3 w-3" /> Refresh
            </Button>
            <Button size="sm" onClick={runAll} disabled={runningAll || cards.length === 0}>
              <Play className="mr-1 h-3 w-3" />
              {runningAll ? "Running all…" : "Run all T1"}
            </Button>
          </div>
        </div>

        {runError && <div className="rounded-md border border-loss/40 bg-loss/10 p-2 text-xs text-loss">{runError}</div>}

        {cards.length === 0 ? (
          <div className="rounded-md border border-dashed p-6 text-center text-xs text-muted-foreground">
            No T1 tickers in your book. Add at least one ticker tiered T1 in the Book tab to start running the agent.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {cards.map((c) => (
              <ErrorBoundary key={c.symbol} label={c.symbol}>
                <ThesisCard card={c} onRefreshed={() => mutate()} />
              </ErrorBoundary>
            ))}
          </div>
        )}

        <ErrorBoundary label="Trade idea">
          <TradeIdeaPanel />
        </ErrorBoundary>

        <ErrorBoundary label="Status change feed">
          <StatusChangeFeed changes={changes} />
        </ErrorBoundary>
      </div>

      <div className="min-h-0">
        <ErrorBoundary label="Chat">
          <ChatPanel />
        </ErrorBoundary>
      </div>
    </div>
  );
}
