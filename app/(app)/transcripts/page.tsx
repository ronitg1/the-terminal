"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { Download, ExternalLink, History, Search, Sparkles, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { AnalysisCards } from "@/components/transcripts/AnalysisCards";
import { cn, timeAgo } from "@/lib/utils";
import type { Ticker } from "@/lib/types/db";
import type { TranscriptListRow } from "@/app/api/transcripts/route";
import type { TranscriptAnalysisOutput } from "@/lib/agent/transcriptAnalysis";

interface SearchResult {
  title: string;
  url: string;
  publishedDate?: string;
  snippet: string;
  trusted: boolean;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function TranscriptsPage() {
  const [symbol, setSymbol] = useState<string>("");
  const [transcript, setTranscript] = useState("");
  const [reportDate, setReportDate] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeAnalysis, setActiveAnalysis] = useState<{ id: string | null; output: TranscriptAnalysisOutput } | null>(null);

  // Auto-fetch state
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [findingTranscript, setFindingTranscript] = useState(false);
  const [extractingUrl, setExtractingUrl] = useState<string | null>(null);
  const [manualUrl, setManualUrl] = useState("");
  const [sourceUrl, setSourceUrl] = useState<string | null>(null);

  // Pull user's tickers for the symbol dropdown.
  const { data: tickersData } = useSWR<{ tickers: Ticker[] }>("/api/tickers", fetcher);
  const tickers = tickersData?.tickers ?? [];

  // Default the symbol to the first T1 ticker on load.
  useEffect(() => {
    if (!symbol && tickers.length > 0) {
      const t1 = tickers.find((t) => t.tier === 1) ?? tickers[0];
      setSymbol(t1.symbol);
    }
  }, [tickers, symbol]);

  // Pull transcript history for the selected ticker.
  const { data: historyData, mutate: mutateHistory } = useSWR<{ transcripts: TranscriptListRow[] }>(
    symbol ? `/api/transcripts?symbol=${encodeURIComponent(symbol)}` : null,
    fetcher,
    { revalidateOnFocus: true },
  );
  const history = historyData?.transcripts ?? [];

  // The currently displayed analysis: either the one we just ran, or the most recent for this symbol.
  const displayed: { id: string | null; output: TranscriptAnalysisOutput; generated_at?: string } | null = useMemo(() => {
    if (activeAnalysis) return activeAnalysis;
    if (history.length > 0) {
      return { id: history[0].id, output: rowToOutput(history[0]), generated_at: history[0].generated_at };
    }
    return null;
  }, [activeAnalysis, history]);

  async function findLatest() {
    if (!symbol) return;
    setFindingTranscript(true);
    setError(null);
    setSearchResults(null);
    try {
      const params = new URLSearchParams({ symbol });
      if (reportDate) {
        // Convert date to "Q[N] YYYY" guess for the search query.
        const d = new Date(reportDate);
        if (!Number.isNaN(d.getTime())) {
          const q = Math.floor(d.getMonth() / 3) + 1;
          params.set("quarter", `Q${q} ${d.getFullYear()}`);
        }
      }
      const res = await fetch(`/api/transcripts/find?${params.toString()}`);
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setSearchResults(j.results ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFindingTranscript(false);
    }
  }

  async function extractFromUrl(url: string) {
    setExtractingUrl(url);
    setError(null);
    try {
      const res = await fetch("/api/transcripts/extract", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setTranscript(j.text);
      setSourceUrl(j.url);
      setSearchResults(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setExtractingUrl(null);
    }
  }

  async function analyze() {
    if (!symbol || transcript.trim().length < 500) {
      setError("Pick a ticker and paste at least 500 characters of transcript.");
      return;
    }
    setRunning(true);
    setError(null);
    setActiveAnalysis(null);
    try {
      const res = await fetch("/api/transcripts/analyze", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol,
          transcript,
          report_date: reportDate || undefined,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error?.message ?? j.error ?? `HTTP ${res.status}`);
      setActiveAnalysis({ id: j.id ?? null, output: j.analysis as TranscriptAnalysisOutput });
      mutateHistory();
      setTranscript("");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  async function deleteAnalysis(id: string) {
    if (!confirm("Delete this transcript analysis?")) return;
    const res = await fetch(`/api/transcripts/${id}`, { method: "DELETE" });
    if (res.ok) {
      if (activeAnalysis?.id === id) setActiveAnalysis(null);
      mutateHistory();
    }
  }

  function loadHistoryItem(row: TranscriptListRow) {
    setActiveAnalysis({ id: row.id, output: rowToOutput(row) });
  }

  return (
    <div className="grid h-[calc(100vh-7rem)] grid-cols-1 gap-4 lg:grid-cols-[26rem_1fr]">
      {/* Left column — input + history */}
      <div className="flex min-h-0 flex-col space-y-3">
        <ErrorBoundary label="Transcript input">
          <div className="rounded-md border bg-card p-3">
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Ticker</Label>
                  <Select value={symbol} onValueChange={setSymbol}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {tickers.map((t) => (
                        <SelectItem key={t.symbol} value={t.symbol}>
                          T{t.tier} · {t.symbol}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">Report date (optional)</Label>
                  <Input
                    type="date"
                    value={reportDate}
                    onChange={(e) => setReportDate(e.target.value)}
                    className="h-8 text-xs"
                  />
                </div>
              </div>

              <div className="rounded-md border border-dashed bg-muted/30 p-2">
                <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                  Auto-fetch (via Tavily)
                </div>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={findLatest}
                    disabled={findingTranscript || !symbol}
                    className="flex-1"
                  >
                    <Search className={cn("mr-1 h-3 w-3", findingTranscript && "animate-pulse")} />
                    {findingTranscript ? "Searching…" : "Find latest"}
                  </Button>
                </div>
                <div className="mt-1 flex gap-1">
                  <Input
                    value={manualUrl}
                    onChange={(e) => setManualUrl(e.target.value)}
                    placeholder="…or paste a transcript URL"
                    className="h-8 flex-1 text-[11px]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => manualUrl && extractFromUrl(manualUrl)}
                    disabled={!manualUrl || extractingUrl !== null}
                  >
                    <Download className={cn("h-3 w-3", extractingUrl === manualUrl && "animate-pulse")} />
                  </Button>
                </div>

                {searchResults && searchResults.length > 0 && (
                  <ul className="mt-2 space-y-1 text-[11px]">
                    {searchResults.map((r) => (
                      <li key={r.url}>
                        <button
                          onClick={() => extractFromUrl(r.url)}
                          disabled={extractingUrl !== null}
                          className={cn(
                            "block w-full rounded-sm border bg-card p-1.5 text-left hover:bg-accent disabled:opacity-50",
                            r.trusted && "border-tier1/40",
                          )}
                        >
                          <div className="flex items-baseline justify-between gap-2">
                            <span className="line-clamp-1 font-semibold">{r.title}</span>
                            {r.trusted && <span className="rounded-sm border border-tier1/40 px-1 text-[9px] uppercase tracking-wider text-tier1">trusted</span>}
                          </div>
                          <div className="flex items-center gap-1 text-muted-foreground">
                            <ExternalLink className="h-2.5 w-2.5" />
                            <span className="line-clamp-1">{hostnameOf(r.url)}</span>
                            {r.publishedDate && <span className="ml-auto">{r.publishedDate.slice(0, 10)}</span>}
                          </div>
                          {extractingUrl === r.url && (
                            <div className="mt-1 text-[10px] text-tier1">Extracting…</div>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {searchResults && searchResults.length === 0 && (
                  <div className="mt-1 text-[10px] text-muted-foreground">No results — try a manual URL or paste below.</div>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  Transcript ({transcript.length.toLocaleString()} chars)
                  {sourceUrl && (
                    <a
                      href={sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-2 inline-flex items-center gap-0.5 text-tier1 hover:underline"
                    >
                      <ExternalLink className="h-2.5 w-2.5" /> source
                    </a>
                  )}
                </Label>
                <Textarea
                  value={transcript}
                  onChange={(e) => {
                    setTranscript(e.target.value);
                    if (sourceUrl) setSourceUrl(null);
                  }}
                  rows={12}
                  placeholder="Paste the entire earnings call transcript here — prepared remarks AND Q&A. Or use Auto-fetch above."
                  className="font-mono text-[11px]"
                />
              </div>

              <Button onClick={analyze} disabled={running || !symbol || transcript.length < 500} className="w-full">
                <Sparkles className={cn("mr-1 h-3 w-3", running && "animate-pulse")} />
                {running ? "Analyzing… (~10-30s)" : "Analyze transcript"}
              </Button>

              {error && (
                <div className="rounded-md border border-loss/40 bg-loss/10 p-2 text-xs text-loss">{error}</div>
              )}
            </div>
          </div>
        </ErrorBoundary>

        <div className="flex min-h-0 flex-1 flex-col rounded-md border bg-card">
          <div className="border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <History className="h-3 w-3" />
              History {symbol && `· ${symbol}`} ({history.length})
            </span>
          </div>
          <div className="flex-1 overflow-y-auto">
            {history.length === 0 ? (
              <div className="p-6 text-center text-xs text-muted-foreground">No analyses yet for {symbol}.</div>
            ) : (
              <ul className="divide-y">
                {history.map((row) => {
                  const isActive = displayed?.id === row.id;
                  const score = row.sentiment_score ?? 0;
                  const scoreColor = score > 2 ? "text-gain" : score < -2 ? "text-loss" : "text-amber-500";
                  const impact = (row.data as { thesisImpact?: { direction?: string } })?.thesisImpact?.direction;
                  return (
                    <li key={row.id}>
                      <button
                        onClick={() => loadHistoryItem(row)}
                        className={cn(
                          "flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-accent",
                          isActive && "bg-accent",
                        )}
                      >
                        <div className="flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono">{row.generated_at.slice(0, 10)}</span>
                            <span className={cn("font-mono text-[11px] tabular-nums", scoreColor)}>
                              {score >= 0 ? "+" : ""}
                              {score}
                            </span>
                            {impact && (
                              <span
                                className={cn(
                                  "rounded-sm border px-1 text-[9px] uppercase tracking-wider",
                                  impact === "strengthens" && "border-tier1/40 text-tier1",
                                  impact === "confirms" && "border-gain/40 text-gain",
                                  impact === "weakens" && "border-amber-500/40 text-amber-500",
                                  impact === "breaks" && "border-loss/40 text-loss",
                                )}
                              >
                                {impact}
                              </span>
                            )}
                          </div>
                          {row.tone_delta && (
                            <div className="mt-0.5 line-clamp-2 text-muted-foreground">{row.tone_delta}</div>
                          )}
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteAnalysis(row.id);
                          }}
                          className="rounded-sm p-1 text-muted-foreground hover:bg-loss/10 hover:text-loss"
                          aria-label="Delete"
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>

      {/* Right column — analysis */}
      <div className="min-h-0 overflow-y-auto">
        {displayed ? (
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <div>
                <div className="text-sm font-semibold uppercase tracking-wider">{symbol} analysis</div>
                {displayed.generated_at && (
                  <div className="text-[10px] text-muted-foreground">
                    generated {timeAgo(displayed.generated_at)}
                  </div>
                )}
                {!displayed.generated_at && (
                  <div className="text-[10px] text-tier1">just analyzed</div>
                )}
              </div>
            </div>
            <Separator />
            <AnalysisCards a={displayed.output} />
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded-md border border-dashed text-center text-xs text-muted-foreground">
            <div className="max-w-md p-8">
              <Sparkles className="mx-auto mb-3 h-6 w-6 opacity-50" />
              <div className="text-sm font-semibold uppercase tracking-wider">Paste an earnings call</div>
              <div className="mt-2">
                Pick a ticker, paste the full transcript (prepared remarks + Q&A), and click <strong>Analyze transcript</strong>.
              </div>
              <div className="mt-2 text-[11px]">
                The agent extracts sentiment vs last quarter, tone delta with cited language, key themes with relevance, guidance hedging, dodged analyst questions, competitive mentions, policy/regulatory references, thesis impact, and what to watch next quarter.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function hostnameOf(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
}

function rowToOutput(row: TranscriptListRow): TranscriptAnalysisOutput {
  const data = (row.data as Record<string, unknown>) ?? {};
  return {
    sentimentScore: row.sentiment_score ?? 0,
    toneDelta: row.tone_delta ?? "",
    keyThemes: Array.isArray(row.key_themes) ? (row.key_themes as TranscriptAnalysisOutput["keyThemes"]) : [],
    guidanceLanguage: row.guidance_language ?? "",
    dodgedQuestions: Array.isArray(row.dodged_questions) ? (row.dodged_questions as TranscriptAnalysisOutput["dodgedQuestions"]) : [],
    competitiveMentions: Array.isArray(data.competitiveMentions) ? (data.competitiveMentions as TranscriptAnalysisOutput["competitiveMentions"]) : [],
    policyMentions: Array.isArray(data.policyMentions) ? (data.policyMentions as TranscriptAnalysisOutput["policyMentions"]) : [],
    thesisImpact: (data.thesisImpact as TranscriptAnalysisOutput["thesisImpact"]) ?? { direction: "confirms", narrative: "" },
    watchNextQuarter: Array.isArray(data.watchNextQuarter) ? (data.watchNextQuarter as string[]) : [],
  };
}
