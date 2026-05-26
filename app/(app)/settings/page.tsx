"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { PushRegistration } from "@/components/settings/PushRegistration";
import { WeeklyEmailControls, DailyEmailControls } from "@/components/settings/WeeklyEmailControls";
import { cn, timeAgo } from "@/lib/utils";
import type { UserSettings, PeerGroup } from "@/lib/settings";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export default function SettingsPage() {
  const { data, mutate } = useSWR<{ settings: UserSettings }>("/api/settings", fetcher);
  const [draft, setDraft] = useState<UserSettings | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (data?.settings && !draft) {
      setDraft(data.settings);
    }
  }, [data, draft]);

  if (!draft || !data) {
    return <div className="rounded-md border p-8 text-center text-xs text-muted-foreground">Loading settings…</div>;
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(data.settings);

  async function save() {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : "Failed to save");
      mutate({ settings: j.settings });
      setDraft(j.settings);
      setSavedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    if (data?.settings) setDraft(data.settings);
    setError(null);
  }

  return (
    <div className="space-y-4">
      <div className="sticky top-0 z-10 -mx-3 flex items-center justify-between border-b bg-background px-3 py-2 backdrop-blur">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wider">Settings</div>
          <div className="text-[10px] text-muted-foreground">
            Peer groups, macro search terms, and book sizing drive News, the agent, and the position sizer.
          </div>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && <span className="text-[10px] text-muted-foreground">saved {timeAgo(savedAt)}</span>}
          {dirty && (
            <Button size="sm" variant="ghost" onClick={discard} disabled={saving}>
              <X className="mr-1 h-3 w-3" /> Discard
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            <Save className="mr-1 h-3 w-3" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-loss/40 bg-loss/10 p-3 text-xs text-loss">{error}</div>
      )}

      <ErrorBoundary label="Book size">
        <section className="space-y-2 rounded-md border bg-card p-4">
          <SectionTitle>Book size</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Used by the position sizing calculator and the trade-idea generator.
          </p>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">$</span>
            <Input
              type="number"
              value={draft.bookSizeUsd}
              onChange={(e) => setDraft({ ...draft, bookSizeUsd: Math.max(0, Number(e.target.value) || 0) })}
              className="max-w-[14rem]"
            />
            <span className="text-xs text-muted-foreground">USD</span>
          </div>
        </section>
      </ErrorBoundary>

      <ErrorBoundary label="Ticker metadata">
        <TickerMetadataSection />
      </ErrorBoundary>

      <ErrorBoundary label="Peer groups">
        <PeerGroupsSection
          groups={draft.peerGroups}
          onChange={(peerGroups) => setDraft({ ...draft, peerGroups })}
        />
      </ErrorBoundary>

      <ErrorBoundary label="Macro search terms">
        <StringListSection
          title="Macro & sector search terms"
          description="The News tab's macro column searches for these. The agent also references them when interpreting policy headlines."
          values={draft.macroSearchTerms}
          onChange={(macroSearchTerms) => setDraft({ ...draft, macroSearchTerms })}
          placeholder="e.g. FEOC final rule"
        />
      </ErrorBoundary>

      <ErrorBoundary label="Mega caps">
        <StringListSection
          title="Mega cap watchlist"
          description="Earnings tab shows these tickers' upcoming earnings in amber (MKT tag). Override the hardcoded list."
          values={draft.megaCaps}
          onChange={(megaCaps) => setDraft({ ...draft, megaCaps: megaCaps.map((s) => s.toUpperCase()) })}
          placeholder="e.g. AAPL"
          uppercase
        />
      </ErrorBoundary>

      <ErrorBoundary label="Daily brief">
        <section className="space-y-2 rounded-md border bg-card p-4">
          <SectionTitle>Daily market brief</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Sent weekdays at 5:30pm ET (post-close) to your account email. Covers the day's index moves, your
            book's performance, top headlines (live Tavily search), thesis flips today, and tomorrow's earnings
            + macro calendar. Requires <code className="rounded bg-muted px-1 py-0.5">RESEND_API_KEY</code> + <code className="rounded bg-muted px-1 py-0.5">TAVILY_API_KEY</code>.
          </p>
          <DailyEmailControls />
        </section>
      </ErrorBoundary>

      <ErrorBoundary label="Weekly email">
        <section className="space-y-2 rounded-md border bg-card p-4">
          <SectionTitle>Weekly email recap</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Sent every Sunday morning (8am ET) to your account email. Includes book performance vs the dominant
            frame benchmark, thesis status changes, and the next 10 days of earnings. Requires <code className="rounded bg-muted px-1 py-0.5">RESEND_API_KEY</code> in env.
          </p>
          <WeeklyEmailControls />
        </section>
      </ErrorBoundary>

      <ErrorBoundary label="Notifications">
        <section className="space-y-3 rounded-md border bg-card p-4">
          <SectionTitle>Notifications</SectionTitle>
          <p className="text-xs text-muted-foreground">
            Browser push notifications. Enable on each browser/device you want alerts on. Requires VAPID
            keys configured server-side.
          </p>
          <PushRegistration />
          <div className="space-y-1.5 border-t pt-3">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Which alerts to send
            </div>
            <ToggleRow
              label="Thesis status changes (weakened / broken)"
              value={draft.notifications.thesisStatusChanges}
              onChange={(v) => setDraft({ ...draft, notifications: { ...draft.notifications, thesisStatusChanges: v } })}
            />
            <ToggleRow
              label="Urgent peer read-throughs (act before open)"
              value={draft.notifications.peerReadthroughsUrgent}
              onChange={(v) => setDraft({ ...draft, notifications: { ...draft.notifications, peerReadthroughsUrgent: v } })}
            />
            <ToggleRow
              label="Unusual options flow on T1 names with earnings ≤ 10d away"
              value={draft.notifications.unusualOptionsFlow}
              onChange={(v) => setDraft({ ...draft, notifications: { ...draft.notifications, unusualOptionsFlow: v } })}
            />
          </div>
        </section>
      </ErrorBoundary>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{children}</div>;
}

// ---------------------------------------------------------------------------
// Peer groups editor
// ---------------------------------------------------------------------------

function PeerGroupsSection({
  groups,
  onChange,
}: {
  groups: PeerGroup[];
  onChange: (g: PeerGroup[]) => void;
}) {
  function update(i: number, patch: Partial<PeerGroup>) {
    onChange(groups.map((g, idx) => (idx === i ? { ...g, ...patch } : g)));
  }
  function remove(i: number) {
    onChange(groups.filter((_, idx) => idx !== i));
  }
  function add() {
    onChange([...groups, { name: "New group", members: [], affects: [] }]);
  }

  return (
    <section className="space-y-3 rounded-md border bg-card p-4">
      <div className="flex items-center justify-between">
        <SectionTitle>Peer groups</SectionTitle>
        <Button size="sm" variant="outline" onClick={add}>
          <Plus className="mr-1 h-3 w-3" /> New group
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        When any ticker in <span className="font-medium">Members</span> reports, the agent generates a read-through note for every ticker in <span className="font-medium">Affects</span> (only the affected tickers in your book are scored).
      </p>
      {groups.length === 0 && (
        <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          No peer groups defined. Add one to start receiving peer read-through alerts.
        </div>
      )}
      <div className="space-y-3">
        {groups.map((g, i) => (
          <div key={i} className="space-y-2 rounded-md border bg-secondary/30 p-3">
            <div className="flex items-center gap-2">
              <Input
                value={g.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Group name"
                className="max-w-sm text-sm font-medium"
              />
              <Button size="icon" variant="ghost" onClick={() => remove(i)} className="ml-auto h-8 w-8" aria-label="Remove">
                <Trash2 className="h-3.5 w-3.5 text-loss" />
              </Button>
            </div>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <TickerList
                label="Members"
                values={g.members}
                onChange={(members) => update(i, { members })}
                placeholder="Add ticker"
              />
              <TickerList
                label="Affects (in your book)"
                values={g.affects}
                onChange={(affects) => update(i, { affects })}
                placeholder="Add ticker"
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// Compact pill-style ticker editor.
function TickerList({
  label,
  values,
  onChange,
  placeholder,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");
  function addOne() {
    const t = input.trim().toUpperCase();
    if (!t || values.includes(t)) return;
    onChange([...values, t]);
    setInput("");
  }
  function removeOne(t: string) {
    onChange(values.filter((v) => v !== t));
  }
  return (
    <div className="space-y-1">
      <Label className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</Label>
      <div className="flex flex-wrap gap-1">
        {values.map((t) => (
          <span
            key={t}
            className="inline-flex items-center gap-0.5 rounded-sm border bg-card px-1.5 py-0.5 font-mono text-[11px]"
          >
            {t}
            <button onClick={() => removeOne(t)} className="hover:text-loss" aria-label={`Remove ${t}`}>
              <X className="h-2.5 w-2.5" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addOne();
            }
          }}
          placeholder={placeholder}
          className="h-7 max-w-[10rem] font-mono text-[11px] uppercase"
        />
        <Button size="sm" variant="ghost" onClick={addOne} className="h-7 px-2">
          <Plus className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Generic editable string list
// ---------------------------------------------------------------------------

function StringListSection({
  title,
  description,
  values,
  onChange,
  placeholder,
  uppercase,
}: {
  title: string;
  description: string;
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  uppercase?: boolean;
}) {
  const [input, setInput] = useState("");
  function addOne() {
    const v = uppercase ? input.trim().toUpperCase() : input.trim();
    if (!v || values.includes(v)) return;
    onChange([...values, v]);
    setInput("");
  }
  function removeOne(v: string) {
    onChange(values.filter((x) => x !== v));
  }
  return (
    <section className="space-y-2 rounded-md border bg-card p-4">
      <SectionTitle>{title}</SectionTitle>
      <p className="text-xs text-muted-foreground">{description}</p>
      <div className="flex flex-wrap gap-1.5">
        {values.map((v) => (
          <span
            key={v}
            className={cn(
              "inline-flex items-center gap-1 rounded-sm border bg-secondary/40 px-2 py-0.5 text-xs",
              uppercase && "font-mono",
            )}
          >
            {v}
            <button onClick={() => removeOne(v)} className="hover:text-loss" aria-label={`Remove ${v}`}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <Input
          value={input}
          onChange={(e) => setInput(uppercase ? e.target.value.toUpperCase() : e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addOne();
            }
          }}
          placeholder={placeholder}
          className={cn("max-w-md text-xs", uppercase && "font-mono uppercase")}
        />
        <Button size="sm" variant="outline" onClick={addOne}>
          <Plus className="mr-1 h-3 w-3" /> Add
        </Button>
      </div>
    </section>
  );
}

function TickerMetadataSection() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{
    updated: number;
    failed: number;
    tickers: Array<{ symbol: string; sector: string | null; industry: string | null; frame: string; benchmark: string }>;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setRunning(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/tickers/refresh-meta", { method: "POST" });
      const j = await res.json();
      if (!res.ok) throw new Error(typeof j.error === "string" ? j.error : `HTTP ${res.status}`);
      setResult(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="space-y-2 rounded-md border bg-card p-4">
      <div className="flex items-center justify-between">
        <SectionTitle>Ticker industry & benchmark</SectionTitle>
        <Button size="sm" variant="outline" onClick={refresh} disabled={running}>
          <RefreshCw className={cn("mr-1 h-3 w-3", running && "animate-spin")} />
          {running ? "Refreshing…" : "Refresh from Yahoo"}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Each ticker is classified into an industry frame (energy transition, tech/semis, banks, healthcare, consumer, etc.). The frame
        drives the agent&apos;s persona, policy themes, and benchmark ETF for relative-return scoring. Tickers added before this
        landed need to be backfilled.
      </p>

      {error && <div className="rounded-md border border-loss/40 bg-loss/10 p-2 text-xs text-loss">{error}</div>}

      {result && (
        <div className="rounded-md border bg-secondary/30 p-2">
          <div className="text-[10px] text-muted-foreground">
            Updated {result.updated} ticker{result.updated === 1 ? "" : "s"}{result.failed > 0 && ` · ${result.failed} failed`}
          </div>
          <table className="mt-1 w-full text-[11px]">
            <thead className="text-[10px] uppercase text-muted-foreground">
              <tr>
                <th className="px-1 py-0.5 text-left">Sym</th>
                <th className="px-1 py-0.5 text-left">Sector</th>
                <th className="px-1 py-0.5 text-left">Industry</th>
                <th className="px-1 py-0.5 text-left">Frame</th>
                <th className="px-1 py-0.5 text-left">Bench</th>
              </tr>
            </thead>
            <tbody>
              {result.tickers.map((t) => (
                <tr key={t.symbol} className="border-t">
                  <td className="px-1 py-0.5 font-mono font-semibold">{t.symbol}</td>
                  <td className="px-1 py-0.5">{t.sector ?? "—"}</td>
                  <td className="px-1 py-0.5">{t.industry ?? "—"}</td>
                  <td className="px-1 py-0.5 font-mono">{t.frame}</td>
                  <td className="px-1 py-0.5 font-mono">{t.benchmark}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (b: boolean) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <button
        type="button"
        onClick={() => onChange(!value)}
        className={cn(
          "relative inline-flex h-4 w-7 shrink-0 items-center rounded-full border transition-colors",
          value ? "border-tier1 bg-tier1" : "border-muted bg-muted",
        )}
      >
        <span
          className={cn(
            "inline-block h-3 w-3 transform rounded-full bg-background transition-transform",
            value ? "translate-x-3" : "translate-x-0.5",
          )}
        />
      </button>
      <span>{label}</span>
    </label>
  );
}

// Suppress unused-import warnings when the helpers below are referenced later.
void Separator;
