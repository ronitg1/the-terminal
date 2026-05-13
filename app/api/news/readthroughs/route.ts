// Peer read-through engine. Detects peer reporters in the last N days, then
// either (GET) returns already-saved read-throughs, or (POST) generates new
// ones for pairs we haven't covered yet.

import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { getUserSettings, affectedBookTickersForReporter } from "@/lib/settings";
import { getNextEarnings } from "@/lib/providers/earnings-calendar";
import { getNewsProvider } from "@/lib/providers/news";
import { generatePeerReadthrough, type ReadthroughOutput } from "@/lib/agent/peerReadthrough";
import { sendPushToUser } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const LOOKBACK_DAYS = 7;

interface PeerReadthroughRow {
  id: string;
  reporting_symbol: string;
  affected_symbol: string;
  summary: string | null;
  sentiment: string | null;
  data: { urgency?: string; bullets?: string[]; group?: string } | null;
  generated_at: string;
}

export async function GET() {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000).toISOString();
  const { data, error } = await supabase
    .from("peer_readthroughs")
    .select("id,reporting_symbol,affected_symbol,summary,sentiment,data,generated_at")
    .eq("user_id", user.user.id)
    .gte("generated_at", cutoff)
    .order("generated_at", { ascending: false })
    .limit(100);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ readthroughs: (data ?? []) as PeerReadthroughRow[] });
}

interface DetectedPair {
  reporterSymbol: string;
  reporterName: string | null;
  affectedSymbol: string;
  affectedName: string | null;
  groupName: string;
  reportedDate: string | null;
}

export async function POST(_req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  try {
    await ensureBudget(supabase, user.user.id);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message, month: err.month }, { status: 402 });
    }
    throw err;
  }

  const [{ data: tickerRows }, settings] = await Promise.all([
    supabase
      .from("tickers")
      .select("symbol,name")
      .eq("user_id", user.user.id),
    getUserSettings(supabase, user.user.id),
  ]);
  const myTickers = (tickerRows ?? []) as Array<{ symbol: string; name: string | null }>;
  const mySymbolSet = new Set(myTickers.map((t) => t.symbol));
  const tickerNameBySymbol = new Map(myTickers.map((t) => [t.symbol, t.name]));

  // Build candidate (reporter, affected) pairs from peer groups.
  const candidatePairs: DetectedPair[] = [];
  const seenPair = new Set<string>();
  for (const group of settings.peerGroups) {
    for (const member of group.members) {
      if (mySymbolSet.has(member)) continue; // a reporter we'd care about must be OUTSIDE the book (peer)
      for (const affected of group.affects) {
        if (!mySymbolSet.has(affected)) continue; // only care about effects on book names
        const key = `${member}__${affected}`;
        if (seenPair.has(key)) continue;
        seenPair.add(key);
        candidatePairs.push({
          reporterSymbol: member,
          reporterName: null,
          affectedSymbol: affected,
          affectedName: tickerNameBySymbol.get(affected) ?? null,
          groupName: group.name,
          reportedDate: null,
        });
      }
    }
  }

  if (candidatePairs.length === 0) {
    return NextResponse.json({
      detected: 0,
      generated: 0,
      readthroughs: [],
      message: "No (peer → my-book) pairs configured. Add peer groups in Settings.",
    });
  }

  // For each candidate reporter, ask Yahoo if their last earnings was in our lookback window.
  const reporterSymbols = Array.from(new Set(candidatePairs.map((p) => p.reporterSymbol)));
  const reporterEarnings = await Promise.all(reporterSymbols.map((s) => getNextEarnings(s)));
  const earningsBySym = new Map(reporterEarnings.map((e) => [e.symbol, e]));

  // "Recently reported" = daysUntil is negative and within lookback, OR daysUntil is 0
  // (today). We treat events from -7..0 as candidates for read-through.
  const recentlyReported = new Set<string>();
  for (const e of reporterEarnings) {
    if (e.daysUntil != null && e.daysUntil <= 0 && e.daysUntil >= -LOOKBACK_DAYS) {
      recentlyReported.add(e.symbol);
    }
  }

  const relevantPairs = candidatePairs.filter((p) => recentlyReported.has(p.reporterSymbol));
  if (relevantPairs.length === 0) {
    return NextResponse.json({
      detected: 0,
      generated: 0,
      readthroughs: [],
      message: `No peers reported in the last ${LOOKBACK_DAYS}d. Nothing to read through.`,
    });
  }

  // De-dupe against existing read-throughs already generated in this lookback window.
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 86400 * 1000).toISOString();
  const { data: existing } = await supabase
    .from("peer_readthroughs")
    .select("reporting_symbol,affected_symbol,generated_at")
    .eq("user_id", user.user.id)
    .gte("generated_at", cutoff);
  type Existing = { reporting_symbol: string; affected_symbol: string };
  const existingKeys = new Set(
    ((existing ?? []) as Existing[]).map((r) => `${r.reporting_symbol}__${r.affected_symbol}`),
  );
  const pairsToRun = relevantPairs.filter(
    (p) => !existingKeys.has(`${p.reporterSymbol}__${p.affectedSymbol}`),
  );

  // Pull latest thesis content for each affected ticker (one query, then map).
  const affectedSymbols = Array.from(new Set(pairsToRun.map((p) => p.affectedSymbol)));
  const { data: theses } = await supabase
    .from("thesis_snapshots")
    .select("symbol,content,generated_at")
    .eq("user_id", user.user.id)
    .in("symbol", affectedSymbols)
    .order("generated_at", { ascending: false });
  const thesisBySym = new Map<string, string>();
  for (const t of (theses ?? []) as Array<{ symbol: string; content: string }>) {
    if (!thesisBySym.has(t.symbol)) thesisBySym.set(t.symbol, t.content);
  }

  // Generate read-throughs sequentially (each is a single small LLM call).
  const news = getNewsProvider();
  const inserted: PeerReadthroughRow[] = [];
  const generatedOutputs: Array<{ pair: DetectedPair; out: ReadthroughOutput }> = [];

  for (const pair of pairsToRun) {
    try {
      const headlines = await news.forSymbol(pair.reporterSymbol, 48);
      const earnings = earningsBySym.get(pair.reporterSymbol);
      const result = await generatePeerReadthrough({
        reporterSymbol: pair.reporterSymbol,
        reporterName: pair.reporterName,
        affectedSymbol: pair.affectedSymbol,
        affectedName: pair.affectedName,
        groupName: pair.groupName,
        existingThesis: thesisBySym.get(pair.affectedSymbol) ?? null,
        headlines,
        asOfIso: new Date().toISOString(),
      });

      await recordUsage(
        {
          userId: user.user.id,
          model: result.model,
          endpoint: "news.peer_readthrough",
          usage: result.usage,
        },
        supabase,
      );

      const insertRow = {
        user_id: user.user.id,
        reporting_symbol: pair.reporterSymbol,
        affected_symbol: pair.affectedSymbol,
        summary: result.output.summary,
        sentiment: result.output.sentiment,
        data: {
          urgency: result.output.urgency,
          bullets: result.output.bullets,
          group: pair.groupName,
          reporterReportDate: earnings?.earningsDate ?? null,
        },
      };
      const { data: row, error } = await supabase
        .from("peer_readthroughs")
        .insert(insertRow)
        .select("id,reporting_symbol,affected_symbol,summary,sentiment,data,generated_at")
        .single();
      if (error) {
        console.error("peer_readthroughs insert failed", pair, error);
        continue;
      }
      inserted.push(row as PeerReadthroughRow);
      generatedOutputs.push({ pair, out: result.output });
    } catch (err) {
      console.error("peer read-through generation failed", pair, err);
    }
  }

  // Push urgent read-throughs (act_before_open) to the user.
  let pushed = 0;
  if (settings.notifications.peerReadthroughsUrgent) {
    const urgent = generatedOutputs.filter((g) => g.out.urgency === "act_before_open");
    for (const { pair, out } of urgent) {
      const res = await sendPushToUser(
        user.user.id,
        {
          title: `${pair.affectedSymbol}: ${pair.reporterSymbol} read-through — act before open`,
          body: out.summary.slice(0, 300),
          url: `/news?symbol=${encodeURIComponent(pair.affectedSymbol)}`,
          tag: `readthrough-${pair.reporterSymbol}-${pair.affectedSymbol}`,
          requireInteraction: true,
        },
        supabase,
      );
      if (res.sent > 0) pushed++;
    }
  }

  return NextResponse.json({
    detected: relevantPairs.length,
    generated: inserted.length,
    skipped: relevantPairs.length - pairsToRun.length,
    pushed,
    readthroughs: inserted,
  });
}

// Need to add an UPDATE policy for peer_readthroughs? Inserts/selects only here.
// data jsonb column doesn't exist in the original schema; let's add it via migration.
