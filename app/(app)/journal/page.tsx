"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { Search, Sparkles, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { JournalCalendar } from "@/components/journal/JournalCalendar";
import { PatternsPanel } from "@/components/journal/PatternsPanel";
import { cn, timeAgo } from "@/lib/utils";
import type { JournalDay, JournalEntry } from "@/app/api/journal/route";

const TAG_OPTIONS = ["pre-trade", "post-trade", "thesis-update", "macro", "meeting-note", "earnings-debrief"] as const;
type Tag = (typeof TAG_OPTIONS)[number];

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface OrganizedOutput {
  rewritten: string;
  rewriteSummary: string;
  tradeIdeas: Array<{ symbol: string; direction: string; structure: string; rationale: string }>;
  thesisChanges: Array<{ symbol: string; change: string }>;
  actionItems: Array<{ task: string; ticker: string | null; deadline: string | null }>;
  risksFlagged: Array<{ risk: string; ticker: string | null }>;
  tagsSuggested: string[];
}

interface WeeklySummary {
  headline: string;
  performance: string;
  thesisChanges: string;
  upcoming: string;
  callToAction: string[];
}

export default function JournalPage() {
  const [selectedDate, setSelectedDate] = useState<string>(() => toIso(new Date()));
  const [monthStart, setMonthStart] = useState(() => firstOfMonth(new Date()));
  const [content, setContent] = useState("");
  const [tags, setTags] = useState<Tag[]>([]);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [organized, setOrganized] = useState<OrganizedOutput | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [organizeError, setOrganizeError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Calendar dots
  const { data: daysData, mutate: mutateDays } = useSWR<{ days: JournalDay[] }>(
    `/api/journal?from=${firstOfMonthIso(monthStart, -1)}&to=${firstOfMonthIso(monthStart, 2)}`,
    fetcher,
    { revalidateOnFocus: true },
  );
  const days = daysData?.days ?? [];

  // Selected entry
  const { data: entryData } = useSWR<{ entry: JournalEntry | null }>(
    `/api/journal?date=${selectedDate}`,
    fetcher,
  );
  const entry = entryData?.entry ?? null;

  useEffect(() => {
    if (entryData) {
      setContent(entry?.content ?? "");
      setTags(((entry?.tags ?? []) as string[]).filter((t): t is Tag => TAG_OPTIONS.includes(t as Tag)));
      setOrganized(null);
      setOrganizeError(null);
      setSavedAt(null);
    }
  }, [entryData, entry]);

  function scheduleSave(next: { content?: string; tags?: Tag[] }) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      setSaving(true);
      setSaveError(null);
      try {
        const res = await fetch("/api/journal", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            date: selectedDate,
            content: next.content ?? content,
            tags: next.tags ?? tags,
          }),
        });
        const j = await res.json().catch(() => null);
        if (res.ok) {
          setSavedAt(new Date().toISOString());
          mutateDays();
        } else {
          setSaveError(
            typeof j?.error === "string" ? j.error : `Save failed (HTTP ${res.status})`,
          );
        }
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    }, 500);
  }

  function toggleTag(t: Tag) {
    const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
    setTags(next);
    scheduleSave({ tags: next });
  }

  async function organize() {
    if (!content || content.trim().length < 20) {
      setOrganizeError("Need at least 20 characters of content to organize.");
      return;
    }
    setOrganizing(true);
    setOrganizeError(null);
    setOrganized(null);
    try {
      const res = await fetch("/api/journal/organize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, date: selectedDate }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : `HTTP ${res.status}`);
      setOrganized(j.organized as OrganizedOutput);
    } catch (err) {
      setOrganizeError(err instanceof Error ? err.message : String(err));
    } finally {
      setOrganizing(false);
    }
  }

  function applySuggestedTags() {
    if (!organized) return;
    const suggested = organized.tagsSuggested.filter((t): t is Tag => TAG_OPTIONS.includes(t as Tag));
    const merged = Array.from(new Set([...tags, ...suggested]));
    setTags(merged);
    scheduleSave({ tags: merged });
  }

  function replaceWithRewrite() {
    if (!organized?.rewritten) return;
    setContent(organized.rewritten);
    scheduleSave({ content: organized.rewritten });
  }

  return (
    <div className="grid h-[calc(100vh-5rem)] grid-cols-1 gap-3 lg:grid-cols-[15rem_1fr_18rem]">
      {/* Left: calendar + recent entries + search */}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <ErrorBoundary label="Calendar">
          <JournalCalendar
            monthStart={monthStart}
            onChangeMonth={setMonthStart}
            days={days}
            selectedDate={selectedDate}
            onSelectDate={(iso) => setSelectedDate(iso)}
          />
        </ErrorBoundary>
        <ErrorBoundary label="Recent entries">
          <RecentEntries
            days={days}
            selectedDate={selectedDate}
            onPick={(date) => {
              setSelectedDate(date);
              setMonthStart(firstOfMonth(new Date(date)));
            }}
          />
        </ErrorBoundary>
        <ErrorBoundary label="Search">
          <SearchPanel
            value={searchInput}
            onChange={setSearchInput}
            onPick={(date) => {
              setSelectedDate(date);
              setMonthStart(firstOfMonth(new Date(date)));
            }}
          />
        </ErrorBoundary>
      </div>

      {/* Center: editor */}
      <div className="flex min-h-0 flex-col">
        <ErrorBoundary label="Editor">
          <div className="flex min-h-0 flex-col rounded-md border bg-card">
            <div className="flex items-center justify-between border-b px-3 py-2">
              <div>
                <div className="text-sm font-semibold uppercase tracking-wider">{prettyDate(selectedDate)}</div>
                <div className="text-[10px] text-muted-foreground">
                  {entry ? `last updated ${timeAgo(entry.updated_at)}` : "new entry"}
                  {saving && <span className="ml-2 text-muted-foreground">saving…</span>}
                  {savedAt && !saving && <span className="ml-2 text-tier1">saved {timeAgo(savedAt)}</span>}
                </div>
              </div>
              <Button size="sm" onClick={organize} disabled={organizing || content.trim().length < 20}>
                <Sparkles className={cn("mr-1 h-3 w-3", organizing && "animate-pulse")} />
                {organizing ? "Organizing…" : "AI organize"}
              </Button>
            </div>
            {saveError && (
              <div className="border-b border-loss/40 bg-loss/10 px-3 py-2 text-[11px] text-loss">
                <span className="font-semibold">Couldn&apos;t save:</span> {saveError}
              </div>
            )}
            <div className="flex flex-wrap items-center gap-1.5 border-b px-3 py-2">
              <Tag className="h-3 w-3 text-muted-foreground" />
              {TAG_OPTIONS.map((t) => (
                <button
                  key={t}
                  onClick={() => toggleTag(t)}
                  className={cn(
                    "rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider transition-colors",
                    tags.includes(t)
                      ? "border-tier1 bg-tier1/15 text-tier1"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {t}
                </button>
              ))}
            </div>
            <Textarea
              value={content}
              onChange={(e) => {
                setContent(e.target.value);
                scheduleSave({ content: e.target.value });
              }}
              placeholder="Write today's entry — trade plans, post-trade notes, thesis updates, macro observations, meeting notes. Markdown welcome. Hit AI organize when done."
              className="min-h-0 flex-1 resize-none rounded-none border-0 px-4 py-3 font-mono text-sm leading-relaxed focus-visible:ring-0"
            />
          </div>
        </ErrorBoundary>
      </div>

      {/* Right: AI organize + weekly summary */}
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
        <ErrorBoundary label="AI organize">
          <OrganizedPanel
            organized={organized}
            error={organizeError}
            organizing={organizing}
            tags={tags}
            onApplyTags={applySuggestedTags}
            onReplaceWithRewrite={replaceWithRewrite}
          />
        </ErrorBoundary>
        <ErrorBoundary label="Weekly summary">
          <WeeklySummaryPanel />
        </ErrorBoundary>
        <ErrorBoundary label="Pattern analysis">
          <PatternsPanel />
        </ErrorBoundary>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function RecentEntries({
  days,
  selectedDate,
  onPick,
}: {
  days: JournalDay[];
  selectedDate: string;
  onPick: (date: string) => void;
}) {
  // Show the 8 most recent entries that actually have content. Useful for
  // viewing/jumping when the user can't remember an exact date.
  const recent = days.filter((d) => d.has_content).slice(0, 8);

  return (
    <div className="rounded-md border bg-card">
      <div className="border-b px-2 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Recent entries
      </div>
      {recent.length === 0 ? (
        <div className="p-3 text-[11px] text-muted-foreground">
          No saved entries yet. Write one in the center pane — it autosaves 500ms after you stop typing.
        </div>
      ) : (
        <ul className="divide-y">
          {recent.map((d) => (
            <li key={d.date}>
              <button
                onClick={() => onPick(d.date)}
                className={cn(
                  "block w-full px-2 py-1.5 text-left text-[11px] transition-colors hover:bg-accent",
                  d.date === selectedDate && "bg-tier1/10 text-tier1",
                )}
              >
                <div className="flex items-baseline justify-between gap-1">
                  <span className="font-mono">{d.date}</span>
                  {d.tags.length > 0 && (
                    <span className="truncate text-[9px] uppercase tracking-wider text-muted-foreground">
                      {d.tags.join(" · ")}
                    </span>
                  )}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SearchPanel({
  value,
  onChange,
  onPick,
}: {
  value: string;
  onChange: (v: string) => void;
  onPick: (date: string) => void;
}) {
  const trimmed = value.trim();
  const { data, isLoading } = useSWR<{ results: Array<{ id: string; date: string; content: string; tags: string[] }> }>(
    trimmed.length >= 2 ? `/api/journal?search=${encodeURIComponent(trimmed)}` : null,
    fetcher,
  );
  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center gap-1.5 border-b px-2 py-1.5">
        <Search className="h-3 w-3 text-muted-foreground" />
        <Input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search entries…"
          className="h-7 border-0 px-0 text-xs focus-visible:ring-0"
        />
      </div>
      {trimmed.length >= 2 && (
        <div className="max-h-64 overflow-y-auto">
          {isLoading && <div className="p-2 text-[11px] text-muted-foreground">Searching…</div>}
          {data?.results?.length === 0 && (
            <div className="p-2 text-[11px] text-muted-foreground">No matches.</div>
          )}
          <ul className="divide-y">
            {data?.results?.map((r) => (
              <li key={r.id}>
                <button
                  onClick={() => onPick(r.date)}
                  className="block w-full px-2 py-1.5 text-left text-[11px] hover:bg-accent"
                >
                  <div className="font-mono text-muted-foreground">{r.date}</div>
                  <div className="line-clamp-2">{r.content}</div>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function OrganizedPanel({
  organized,
  error,
  organizing,
  tags,
  onApplyTags,
  onReplaceWithRewrite,
}: {
  organized: OrganizedOutput | null;
  error: string | null;
  organizing: boolean;
  tags: Tag[];
  onApplyTags: () => void;
  onReplaceWithRewrite: () => void;
}) {
  const [showRewrite, setShowRewrite] = useState(true);
  return (
    <div className="rounded-md border bg-card">
      <div className="border-b px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        AI organize
      </div>
      <div className="space-y-3 p-3 text-xs">
        {organizing && <div className="text-muted-foreground">Rewriting and extracting trade ideas, thesis changes, action items, risks…</div>}
        {error && <div className="rounded-md border border-loss/40 bg-loss/10 p-2 text-loss">{error}</div>}
        {!organized && !organizing && !error && (
          <div className="text-muted-foreground">
            Write your entry, then click <strong>AI organize</strong> — the agent will polish your entry into a structured rewrite AND extract trade ideas, thesis changes, action items, and risks as separate cards.
          </div>
        )}
        {organized && organized.rewritten && (
          <Section title="Polished rewrite">
            {organized.rewriteSummary && (
              <div className="mb-1.5 text-[10px] italic text-muted-foreground">
                {organized.rewriteSummary}
              </div>
            )}
            {showRewrite ? (
              <div className="rounded-md border bg-secondary/40 p-2 text-[11px] leading-relaxed whitespace-pre-wrap font-mono">
                {organized.rewritten}
              </div>
            ) : (
              <div className="text-[11px] italic text-muted-foreground">Hidden — click "Show" to re-display.</div>
            )}
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              <Button size="sm" onClick={onReplaceWithRewrite}>
                Replace my entry
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowRewrite((s) => !s)}>
                {showRewrite ? "Hide" : "Show"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => navigator.clipboard?.writeText(organized.rewritten).catch(() => undefined)}
              >
                Copy
              </Button>
            </div>
            <div className="mt-1 text-[10px] text-muted-foreground">
              Tip: "Replace my entry" autosaves immediately. Original is gone — copy first if you want to keep both.
            </div>
          </Section>
        )}
        {organized && (
          <>
            {organized.tradeIdeas.length > 0 && (
              <Section title={`Trade ideas (${organized.tradeIdeas.length})`}>
                <ul className="space-y-1">
                  {organized.tradeIdeas.map((t, i) => (
                    <li key={i} className="rounded-sm border bg-secondary/40 p-1.5">
                      <div className="flex items-baseline gap-2">
                        <span className="font-semibold">{t.symbol}</span>
                        <span className="rounded-sm border bg-card px-1 text-[9px] uppercase tracking-wider">{t.direction}</span>
                        <span className="text-[9px] uppercase text-muted-foreground">{t.structure}</span>
                      </div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">{t.rationale}</div>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {organized.thesisChanges.length > 0 && (
              <Section title={`Thesis changes (${organized.thesisChanges.length})`}>
                <ul className="space-y-1">
                  {organized.thesisChanges.map((t, i) => (
                    <li key={i}>
                      <span className="font-semibold">{t.symbol}:</span>{" "}
                      <span>{t.change}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {organized.actionItems.length > 0 && (
              <Section title={`Action items (${organized.actionItems.length})`}>
                <ul className="space-y-1 list-inside list-disc">
                  {organized.actionItems.map((a, i) => (
                    <li key={i}>
                      <span>{a.task}</span>
                      {a.ticker && <span className="ml-1 font-mono text-muted-foreground">[{a.ticker}]</span>}
                      {a.deadline && <span className="ml-1 text-muted-foreground">— {a.deadline}</span>}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {organized.risksFlagged.length > 0 && (
              <Section title={`Risks flagged (${organized.risksFlagged.length})`}>
                <ul className="space-y-1">
                  {organized.risksFlagged.map((r, i) => (
                    <li key={i}>
                      {r.ticker && <span className="font-mono text-muted-foreground">[{r.ticker}] </span>}
                      <span>{r.risk}</span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}
            {organized.tagsSuggested.length > 0 && (
              <Section title="Suggested tags">
                <div className="flex flex-wrap items-center gap-1.5">
                  {organized.tagsSuggested.map((t) => (
                    <span
                      key={t}
                      className={cn(
                        "rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider",
                        tags.includes(t as Tag)
                          ? "border-tier1 bg-tier1/15 text-tier1"
                          : "text-muted-foreground",
                      )}
                    >
                      {t}
                    </span>
                  ))}
                  <Button size="sm" variant="outline" onClick={onApplyTags} className="ml-1 h-6 px-2 text-[10px]">
                    Apply
                  </Button>
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function WeeklySummaryPanel() {
  const [summary, setSummary] = useState<WeeklySummary | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setRunning(true);
    setError(null);
    setSummary(null);
    try {
      const res = await fetch("/api/journal/weekly-summary", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : `HTTP ${res.status}`);
      setSummary(j.summary as WeeklySummary);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-md border bg-card">
      <div className="flex items-center justify-between border-b px-3 py-2">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          This week in my book
        </div>
        <Button size="sm" variant="outline" onClick={run} disabled={running}>
          <Sparkles className={cn("mr-1 h-3 w-3", running && "animate-pulse")} />
          {running ? "Running…" : summary ? "Regenerate" : "Generate"}
        </Button>
      </div>
      <div className="space-y-2 p-3 text-xs">
        {error && <div className="rounded-md border border-loss/40 bg-loss/10 p-2 text-loss">{error}</div>}
        {!summary && !running && !error && (
          <div className="text-muted-foreground">
            On-demand portfolio recap: last week's perf vs ICLN, thesis status changes, and what's coming up next 10 days.
          </div>
        )}
        {summary && (
          <>
            {summary.headline && (
              <p className="text-sm font-semibold leading-snug">{summary.headline}</p>
            )}
            <Separator />
            <Section title="Performance">
              <p className="leading-relaxed">{summary.performance}</p>
            </Section>
            <Section title="Thesis status">
              <p className="leading-relaxed">{summary.thesisChanges}</p>
            </Section>
            <Section title="Upcoming">
              <p className="leading-relaxed">{summary.upcoming}</p>
            </Section>
            {summary.callToAction.length > 0 && (
              <Section title="Watch this week">
                <ul className="list-inside list-disc space-y-0.5">
                  {summary.callToAction.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{title}</div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function firstOfMonthIso(d: Date, monthOffset: number): string {
  return toIso(new Date(d.getFullYear(), d.getMonth() + monthOffset, 1));
}

function toIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function prettyDate(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
