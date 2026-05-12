"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface SearchResult { symbol: string; name: string; type: string | null }

export function AddTickerDialog({
  open,
  onOpenChange,
  onAdded,
}: {
  open: boolean;
  onOpenChange: (b: boolean) => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selected, setSelected] = useState<SearchResult | null>(null);
  const [tier, setTier] = useState<"1" | "2" | "3">("1");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery(""); setResults([]); setSelected(null); setTier("1"); setNotes(""); setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) { setResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/quotes/search?q=${encodeURIComponent(query)}`);
        const json = await res.json();
        setResults(json.results ?? []);
      } catch {
        setResults([]);
      }
    }, 200);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/tickers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          symbol: selected.symbol,
          name: selected.name,
          tier: Number(tier),
          notes,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error?.formErrors?.join(", ") || j.error || "Failed");
      }
      onAdded();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add ticker</DialogTitle>
        </DialogHeader>

        <form onSubmit={submit} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="symbol">Symbol</Label>
            <Input
              id="symbol"
              autoFocus
              placeholder="e.g. FSLR"
              value={selected ? `${selected.symbol} · ${selected.name}` : query}
              onChange={(e) => { setSelected(null); setQuery(e.target.value); }}
            />
            {!selected && results.length > 0 && (
              <ul className="mt-1 max-h-44 overflow-auto rounded-md border bg-popover text-sm">
                {results.map((r) => (
                  <li key={r.symbol}>
                    <button
                      type="button"
                      onClick={() => { setSelected(r); setQuery(r.symbol); }}
                      className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left hover:bg-accent"
                    >
                      <span className="w-16 font-semibold tabular-nums">{r.symbol}</span>
                      <span className="truncate text-muted-foreground">{r.name}</span>
                      {r.type && <span className="ml-auto text-[10px] uppercase text-muted-foreground">{r.type}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Tier</Label>
            <Select value={tier} onValueChange={(v) => setTier(v as "1" | "2" | "3")}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1">T1 — high conviction</SelectItem>
                <SelectItem value="2">T2 — secondary</SelectItem>
                <SelectItem value="3">T3 — watchlist</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Initial thesis</Label>
            <Textarea id="notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Why this name, what's the variant view, key risks…" />
          </div>

          {error && <div className="text-xs text-loss">{error}</div>}

          <div className="flex items-center justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!selected || submitting}>{submitting ? "Adding…" : "Add"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
