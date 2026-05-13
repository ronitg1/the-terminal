import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export interface ThesisSource {
  title: string;
  url?: string;
  publishedAt?: string;
}

export interface ThesisCatalystOut {
  date: string;
  event: string;
  expectedDirection: "bullish" | "bearish" | "neutral";
  expectedImpactPct: string;
}

export interface ThesisStructuredOut {
  variantView: string;
  setup: string;
  drivers: string[];
  catalysts: ThesisCatalystOut[];
  bullCase: { narrative: string; targetPrice: number | null };
  bearCase: { narrative: string; targetPrice: number | null };
  basePrice: number | null;
  positionRisks: string[];
}

export interface AnalystOut {
  perspective: "news" | "technicals" | "fundamentals";
  signalQuality: "bullish" | "bearish" | "mixed" | "noise";
  summary: string;
  bullets: string[];
}

export interface ResearcherOut {
  stance: "bull" | "bear";
  thesis: string;
  targetPrice: number | null;
  mustBeTrue: string[];
  confidence: number;
}

export interface MultiAgentOut {
  analysts?: AnalystOut[];
  bull?: ResearcherOut;
  bear?: ResearcherOut;
}

export interface ThesisDataOut {
  keyDevelopment?: string;
  watch?: string[];
  riskFlags?: string[];
  structured?: ThesisStructuredOut;
  multiAgent?: MultiAgentOut;
}

export interface FeedThesisCard {
  symbol: string;
  name: string | null;
  tier: number;
  latest: {
    id: string;
    status: string;
    conviction: number | null;
    content: string;
    generated_at: string;
    sources: ThesisSource[];
    data: ThesisDataOut;
  } | null;
  history: Array<{ generated_at: string; conviction: number | null; status: string }>;
}

export interface FeedStatusChange {
  symbol: string;
  from: string;
  to: string;
  at: string;
  conviction: number | null;
}

export async function GET() {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const { data: tickers } = await supabase
    .from("tickers")
    .select("symbol,name,tier")
    .eq("user_id", user.user.id)
    .eq("tier", 1)
    .order("symbol");

  const { data: theses } = await supabase
    .from("thesis_snapshots")
    .select("id,symbol,status,conviction,content,sources,data,generated_at")
    .eq("user_id", user.user.id)
    .order("generated_at", { ascending: false });

  const bySym = new Map<string, typeof theses>();
  for (const t of theses ?? []) {
    const arr = bySym.get(t.symbol) ?? [];
    arr.push(t);
    bySym.set(t.symbol, arr as any);
  }

  const cards: FeedThesisCard[] = (tickers ?? []).map((t) => {
    const arr = bySym.get(t.symbol as string) ?? [];
    const latest = arr[0] ?? null;
    const history = arr
      .slice(0, 30)
      .reverse()
      .map((s) => ({ generated_at: s.generated_at, conviction: s.conviction, status: s.status }));
    return {
      symbol: t.symbol as string,
      name: (t.name as string | null) ?? null,
      tier: t.tier as number,
      latest: latest
        ? {
            id: latest.id,
            status: latest.status,
            conviction: latest.conviction,
            content: latest.content,
            generated_at: latest.generated_at,
            sources: Array.isArray((latest as { sources?: unknown }).sources)
              ? ((latest as { sources: ThesisSource[] }).sources)
              : [],
            data: ((latest as { data?: ThesisDataOut }).data ?? {}) as ThesisDataOut,
          }
        : null,
      history,
    };
  });

  // Status change feed: walk each ticker oldest→newest, emit transitions
  const changes: FeedStatusChange[] = [];
  for (const t of tickers ?? []) {
    const arr = (bySym.get(t.symbol as string) ?? []).slice().reverse();
    for (let i = 1; i < arr.length; i++) {
      if (arr[i].status !== arr[i - 1].status) {
        changes.push({
          symbol: t.symbol as string,
          from: arr[i - 1].status,
          to: arr[i].status,
          at: arr[i].generated_at,
          conviction: arr[i].conviction,
        });
      }
    }
  }
  changes.sort((a, b) => (b.at < a.at ? -1 : 1));

  return NextResponse.json({ cards, changes: changes.slice(0, 50) });
}
