// Options flow feed. Pragmatic build: surface chain aggregates (call/put volume,
// OI, notional, ATM IV) and "notable" contracts (highest volume/OI ratio) from
// Yahoo for the user's book + their settings.megaCaps + peer-group members.
//
// Yahoo doesn't expose a true unusual-activity feed; instead we derive an
// activity ranking from the front-month chain. If a ticker has an earnings
// date inside the front-month, we use the earnings expiry instead — that's the
// strip a discretionary PM actually cares about.

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { getOptionsProvider, type ChainSummary } from "@/lib/providers/options";
import { getNextEarningsBatch, MEGA_CAPS as DEFAULT_MEGA_CAPS } from "@/lib/providers/earnings-calendar";
import { getUserSettings } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export type FlowGroup = "mine" | "mega" | "peer";

export interface OptionsFlowRow {
  symbol: string;
  name: string | null;
  group: FlowGroup;
  tier: number | null;
  earningsDate: string | null;
  daysToEarnings: number | null;
  expiryUsed: string | null;       // front-month or earnings expiry
  isEarningsExpiry: boolean;
  summary: ChainSummary | null;
}

export interface OptionsFlowResponse {
  rows: OptionsFlowRow[];
  preEarnings: OptionsFlowRow[];   // mine/peer with earnings ≤ 10 days
  fetchedAt: string;
}

export async function GET(_req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const [{ data: tickerRows }, settings] = await Promise.all([
    supabase
      .from("tickers")
      .select("symbol,name,tier")
      .eq("user_id", user.user.id),
    getUserSettings(supabase, user.user.id),
  ]);

  const myTickers = (tickerRows ?? []) as Array<{ symbol: string; name: string | null; tier: number }>;
  const mySymbolSet = new Set(myTickers.map((t) => t.symbol));

  const megaList =
    settings.megaCaps && settings.megaCaps.length > 0
      ? settings.megaCaps.map((sym) => {
          const known = DEFAULT_MEGA_CAPS.find((d) => d.symbol === sym);
          return { symbol: sym, name: known?.name ?? sym };
        })
      : DEFAULT_MEGA_CAPS.map((m) => ({ symbol: m.symbol, name: m.name }));
  const megaSymbols = megaList.filter((m) => !mySymbolSet.has(m.symbol));
  const megaSymSet = new Set(megaSymbols.map((m) => m.symbol));

  // Peer-group members that aren't already in book or mega list.
  const peerMembers = new Set<string>();
  for (const g of settings.peerGroups) {
    for (const m of g.members) {
      if (!mySymbolSet.has(m) && !megaSymSet.has(m)) peerMembers.add(m);
    }
  }
  const peerList = Array.from(peerMembers).map((sym) => ({ symbol: sym, name: sym }));

  const universe: Array<{ symbol: string; name: string | null; group: FlowGroup; tier: number | null }> = [
    ...myTickers.map((t) => ({ symbol: t.symbol, name: t.name, group: "mine" as const, tier: t.tier })),
    ...megaSymbols.map((m) => ({ symbol: m.symbol, name: m.name, group: "mega" as const, tier: null })),
    ...peerList.map((p) => ({ symbol: p.symbol, name: p.name, group: "peer" as const, tier: null })),
  ];

  // Fetch earnings dates so we can pick the earnings expiry when relevant.
  const earnings = await getNextEarningsBatch(universe.map((u) => u.symbol));
  const earningsBySym = new Map(earnings.map((e) => [e.symbol, e]));

  const provider = getOptionsProvider();
  const rows: OptionsFlowRow[] = await Promise.all(
    universe.map(async (u) => {
      const earn = earningsBySym.get(u.symbol);
      const daysToEarnings = earn?.daysUntil ?? null;
      const earningsDate = earn?.earningsDate ?? null;

      // If earnings are within 35 days, prefer the closest expiry >= earnings.
      let chosenExpiry: string | undefined;
      let isEarningsExpiry = false;
      if (earningsDate && daysToEarnings != null && daysToEarnings >= 0 && daysToEarnings <= 35) {
        const expiries = await provider.expiries(u.symbol).catch(() => [] as string[]);
        const eligible = expiries.filter((d) => d >= earningsDate).sort();
        if (eligible.length > 0) {
          chosenExpiry = eligible[0];
          isEarningsExpiry = true;
        }
      }
      const summary = await provider.chainSummary(u.symbol, chosenExpiry);
      return {
        symbol: u.symbol,
        name: u.name,
        group: u.group,
        tier: u.tier,
        earningsDate,
        daysToEarnings,
        expiryUsed: summary?.expiry ?? chosenExpiry ?? null,
        isEarningsExpiry,
        summary,
      };
    }),
  );

  // Pre-earnings: mine or peer with earnings 0-10 days out.
  const preEarnings = rows
    .filter((r) => r.group !== "mega" && r.daysToEarnings != null && r.daysToEarnings >= 0 && r.daysToEarnings <= 10)
    .sort((a, b) => (a.daysToEarnings ?? 99) - (b.daysToEarnings ?? 99));

  // Sort main table: mine first (by tier asc), then peer, then mega; within each group by total notional desc.
  const groupRank: Record<FlowGroup, number> = { mine: 0, peer: 1, mega: 2 };
  rows.sort((a, b) => {
    if (groupRank[a.group] !== groupRank[b.group]) return groupRank[a.group] - groupRank[b.group];
    if (a.group === "mine" && b.group === "mine") {
      const at = a.tier ?? 99;
      const bt = b.tier ?? 99;
      if (at !== bt) return at - bt;
    }
    const aNotional = (a.summary?.callNotionalUsd ?? 0) + (a.summary?.putNotionalUsd ?? 0);
    const bNotional = (b.summary?.callNotionalUsd ?? 0) + (b.summary?.putNotionalUsd ?? 0);
    return bNotional - aNotional;
  });

  return NextResponse.json(
    { rows, preEarnings, fetchedAt: new Date().toISOString() } satisfies OptionsFlowResponse,
    { headers: { "cache-control": "no-store" } },
  );
}
