import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getNextEarningsBatch, MEGA_CAPS as DEFAULT_MEGA_CAPS } from "@/lib/providers/earnings-calendar";
import { getOptionsProvider } from "@/lib/providers/options";
import { getShortInterestProvider } from "@/lib/providers/short-interest";
import { getEstimateRevisionsProvider } from "@/lib/providers/estimate-revisions";
import { getMacroInRange, type MacroEvent } from "@/lib/macro-calendar";
import { getUserSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type EventGroup = "mine" | "mega" | "other";

export interface CalendarEvent {
  id: string | null;            // earnings_events.id if persisted (checklist/debrief saved)
  symbol: string;
  name: string | null;
  group: EventGroup;
  tier: number | null;          // 1-3 for "mine", null otherwise
  date: string;                 // ISO YYYY-MM-DD
  timing: "BH" | "AH" | null;
  daysUntil: number | null;
  epsEstimate: number | null;
  revenueEstimate: number | null;
  impliedMovePct: number | null;
  siPct: number | null;
  revisionDirection: string | null;
  hasChecklist: boolean;
  hasDebrief: boolean;
}

export interface CalendarResponse {
  events: CalendarEvent[];
  macro: MacroEvent[];
  from: string;
  to: string;
}

export async function GET(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const url = new URL(req.url);
  // Default window: today → +90 days
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const defaultTo = new Date(today.getTime() + 90 * 86400000).toISOString().slice(0, 10);
  const from = url.searchParams.get("from") ?? todayIso;
  const to = url.searchParams.get("to") ?? defaultTo;

  // 1. Get user's tickers (with name + tier) and settings.
  const [{ data: tickerRows }, settings] = await Promise.all([
    supabase
      .from("tickers")
      .select("symbol,name,tier")
      .eq("user_id", user.user.id),
    getUserSettings(supabase, user.user.id),
  ]);
  const myTickers = (tickerRows ?? []) as Array<{ symbol: string; name: string | null; tier: number }>;
  const mySymbolSet = new Set(myTickers.map((t) => t.symbol));

  // Mega caps come from user settings (falls back to defaults). Filter out any
  // that are already in the user's book.
  const megaList =
    settings.megaCaps && settings.megaCaps.length > 0
      ? settings.megaCaps.map((sym) => {
          const known = DEFAULT_MEGA_CAPS.find((d) => d.symbol === sym);
          return { symbol: sym, name: known?.name ?? sym };
        })
      : DEFAULT_MEGA_CAPS;
  const megaSymbols = megaList.filter((m) => !mySymbolSet.has(m.symbol));

  // 2. Fetch next earnings for each ticker in parallel.
  const allSymbols = [...myTickers.map((t) => t.symbol), ...megaSymbols.map((m) => m.symbol)];
  const earnings = await getNextEarningsBatch(allSymbols);

  // Filter to events in the requested window with a valid date.
  const inWindow = earnings.filter(
    (e) => e.earningsDate && e.earningsDate >= from && e.earningsDate <= to,
  );

  // 3. For "mine" events, fetch IV / SI / revisions in parallel (skip mega caps to save calls).
  const mineEarnings = inWindow.filter((e) => mySymbolSet.has(e.symbol));
  const optProvider = getOptionsProvider();
  const siProvider = getShortInterestProvider();
  const revProvider = getEstimateRevisionsProvider();

  const [moves, sis, revs] = await Promise.all([
    Promise.all(mineEarnings.map((e) => optProvider.impliedMove(e.symbol))),
    Promise.all(mineEarnings.map((e) => siProvider.fetch(e.symbol))),
    Promise.all(mineEarnings.map((e) => revProvider.fetch(e.symbol))),
  ]);
  const moveBySym = new Map(moves.map((m) => [m.symbol, m.impliedMovePct]));
  const siBySym = new Map(sis.map((s) => [s.symbol, s.siPct]));
  const revBySym = new Map(revs.map((r) => [r.symbol, r.direction]));

  // 4. Pull any persisted earnings_events rows so we can flag which have a checklist or debrief.
  const persistedKeys = inWindow.map((e) => ({ symbol: e.symbol, report_date: e.earningsDate! }));
  const { data: persistedRows } = await supabase
    .from("earnings_events")
    .select("id,symbol,report_date,checklist_data,debrief_data")
    .eq("user_id", user.user.id)
    .in("symbol", Array.from(new Set(persistedKeys.map((k) => k.symbol))));
  type Persisted = { id: string; symbol: string; report_date: string; checklist_data: Record<string, unknown>; debrief_data: Record<string, unknown> };
  const persistedBySymDate = new Map<string, Persisted>();
  for (const r of (persistedRows ?? []) as Persisted[]) {
    persistedBySymDate.set(`${r.symbol}__${r.report_date}`, r);
  }

  // 5. Build the response events.
  const tickerLookup = new Map(myTickers.map((t) => [t.symbol, t]));
  const megaLookup = new Map(megaList.map((m) => [m.symbol, m]));

  const events: CalendarEvent[] = inWindow.map((e) => {
    const mine = tickerLookup.get(e.symbol);
    const mega = megaLookup.get(e.symbol);
    const group: EventGroup = mine ? "mine" : mega ? "mega" : "other";
    const key = `${e.symbol}__${e.earningsDate!}`;
    const persisted = persistedBySymDate.get(key) ?? null;
    return {
      id: persisted?.id ?? null,
      symbol: e.symbol,
      name: mine?.name ?? mega?.name ?? null,
      group,
      tier: mine?.tier ?? null,
      date: e.earningsDate!,
      timing: e.timing,
      daysUntil: e.daysUntil,
      epsEstimate: e.epsEstimate,
      revenueEstimate: e.revenueEstimate,
      impliedMovePct: mine ? moveBySym.get(e.symbol) ?? null : null,
      siPct: mine ? siBySym.get(e.symbol) ?? null : null,
      revisionDirection: mine ? revBySym.get(e.symbol) ?? null : null,
      hasChecklist: !!persisted && Object.keys(persisted.checklist_data ?? {}).length > 0,
      hasDebrief: !!persisted && Object.keys(persisted.debrief_data ?? {}).length > 0,
    };
  });

  events.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.symbol.localeCompare(b.symbol)));

  return NextResponse.json(
    { events, macro: getMacroInRange(from, to), from, to } satisfies CalendarResponse,
    { headers: { "cache-control": "no-store" } },
  );
}
