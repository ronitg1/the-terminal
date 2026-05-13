// User-level configuration: peer groups, macro search terms, mega cap list,
// notification prefs. Backed by the user_settings table (jsonb blob). Defaults
// come from the spec; the user can override any of them from the Settings tab.

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PeerGroup {
  name: string;                    // human label, e.g. "Solar modules"
  members: string[];               // tickers in the group
  affects: string[];               // tickers in your book impacted by these
}

export interface NotificationPrefs {
  thesisStatusChanges: boolean;    // push when a thesis moves to weakened/broken
  peerReadthroughsUrgent: boolean; // push when a peer read-through is "act before open"
  unusualOptionsFlow: boolean;     // push for unusual options flow on T1 names with earnings <10d away
}

export interface UserSettings {
  peerGroups: PeerGroup[];
  macroSearchTerms: string[];
  megaCaps: string[];              // overrides hardcoded list in earnings-calendar.ts
  bookSizeUsd: number;             // used by position sizing calculator
  notifications: NotificationPrefs;
}

// Out-of-the-box defaults. These are illustrative starter examples — every field
// is editable from the Settings tab. Replace with whatever fits your book.
export const DEFAULT_SETTINGS: UserSettings = {
  peerGroups: [
    {
      name: "AI chips (example)",
      members: ["NVDA", "AMD", "AVGO", "TSM"],
      affects: ["NVDA"],
    },
    {
      name: "Money-center banks (example)",
      members: ["JPM", "BAC", "WFC", "C"],
      affects: ["JPM"],
    },
    {
      name: "Solar (example)",
      members: ["FSLR", "ENPH", "SEDG"],
      affects: ["FSLR"],
    },
  ],
  macroSearchTerms: [
    // The macro column primarily uses Finnhub's general news feed. These extra
    // search terms hit NewsAPI for sector- or policy-specific topics that the
    // general feed may miss. Add/remove freely.
    "Federal Reserve rate decision",
    "China tariffs",
    "AI infrastructure capex",
    "CHIPS Act funding",
  ],
  megaCaps: ["AAPL", "MSFT", "GOOGL", "META", "AMZN", "NVDA", "TSLA", "JPM", "GS", "BRK-B"],
  bookSizeUsd: 200_000,
  notifications: {
    thesisStatusChanges: true,
    peerReadthroughsUrgent: true,
    unusualOptionsFlow: true,
  },
};

// Merge stored partial settings with defaults so missing keys (e.g. after a
// schema extension) don't crash callers.
export function mergeSettings(stored: Partial<UserSettings> | null | undefined): UserSettings {
  if (!stored || typeof stored !== "object") return DEFAULT_SETTINGS;
  return {
    peerGroups: Array.isArray(stored.peerGroups) ? stored.peerGroups : DEFAULT_SETTINGS.peerGroups,
    macroSearchTerms: Array.isArray(stored.macroSearchTerms)
      ? stored.macroSearchTerms
      : DEFAULT_SETTINGS.macroSearchTerms,
    megaCaps: Array.isArray(stored.megaCaps) ? stored.megaCaps : DEFAULT_SETTINGS.megaCaps,
    bookSizeUsd:
      typeof stored.bookSizeUsd === "number" && Number.isFinite(stored.bookSizeUsd)
        ? stored.bookSizeUsd
        : DEFAULT_SETTINGS.bookSizeUsd,
    notifications: { ...DEFAULT_SETTINGS.notifications, ...(stored.notifications ?? {}) },
  };
}

export async function getUserSettings(
  supabase: SupabaseClient,
  userId: string,
): Promise<UserSettings> {
  const { data } = await supabase
    .from("user_settings")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  const stored = (data as { data: Partial<UserSettings> } | null)?.data ?? null;
  return mergeSettings(stored);
}

export async function upsertUserSettings(
  supabase: SupabaseClient,
  userId: string,
  patch: Partial<UserSettings>,
): Promise<UserSettings> {
  // Read-modify-write so the client can send partial patches.
  const current = await getUserSettings(supabase, userId);
  const merged: UserSettings = mergeSettings({ ...current, ...patch });
  await supabase
    .from("user_settings")
    .upsert({ user_id: userId, data: merged, updated_at: new Date().toISOString() });
  return merged;
}

// Resolve which peer groups affect a given ticker — used by the read-through
// detector. If symbol FSLR is in `affects` of "Solar modules", reports from
// any other "Solar modules" member should generate a read-through for FSLR.
export function peerGroupsAffecting(symbol: string, groups: PeerGroup[]): PeerGroup[] {
  return groups.filter((g) => g.affects.includes(symbol));
}

// Reverse: which tickers in MY BOOK are affected when this OTHER ticker reports?
export function affectedBookTickersForReporter(reporterSymbol: string, groups: PeerGroup[]): string[] {
  const out = new Set<string>();
  for (const g of groups) {
    if (g.members.includes(reporterSymbol)) {
      for (const a of g.affects) {
        if (a !== reporterSymbol) out.add(a);
      }
    }
  }
  return Array.from(out);
}
