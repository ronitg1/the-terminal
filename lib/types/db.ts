// Hand-rolled DB types matching supabase/migrations/0001_init.sql.
// Replace with `supabase gen types typescript` output once the Supabase project is linked.

export type TickerTier = 1 | 2 | 3;
export type ThesisStatus = "intact" | "strengthened" | "weakened" | "broken";
export type Sentiment = "positive" | "negative" | "neutral";
export type RevisionDirection = "up" | "down" | "unchanged";

export interface Ticker {
  id: string;
  user_id: string;
  symbol: string;
  name: string | null;
  tier: TickerTier;
  notes: string;
  created_at: string;
  sector?: string | null;
  industry?: string | null;
  frame_id?: string | null;
  benchmark_symbol?: string | null;
}

export interface ThesisSnapshot {
  id: string;
  user_id: string;
  symbol: string;
  content: string;
  sources: unknown;
  status: ThesisStatus;
  conviction: number | null;
  generated_at: string;
}

export interface EarningsEvent {
  id: string;
  user_id: string;
  symbol: string;
  report_date: string;
  timing: "BH" | "AH" | null;
  eps_estimate: number | null;
  rev_estimate: number | null;
  implied_move_pct: number | null;
  actual_eps: number | null;
  actual_rev: number | null;
  stock_reaction_pct: number | null;
  checklist_data: Record<string, unknown>;
  debrief_data: Record<string, unknown>;
  created_at: string;
}

export interface ShortInterestRow {
  id: string;
  user_id: string;
  symbol: string;
  si_pct: number | null;
  days_to_cover: number | null;
  fetched_at: string;
}

export interface EstimateRevisionRow {
  id: string;
  user_id: string;
  symbol: string;
  period: string | null;
  eps_estimate: number | null;
  revision_direction: RevisionDirection | null;
  analyst_count: number | null;
  fetched_at: string;
}

export interface EtfFlowRow {
  id: string;
  user_id: string;
  symbol: string;
  flow_usd: number | null;
  aum: number | null;
  fetched_at: string;
}

export interface Database {
  public: {
    Tables: {
      tickers: { Row: Ticker; Insert: Partial<Ticker> & { user_id: string; symbol: string; tier: TickerTier }; Update: Partial<Ticker> };
      thesis_snapshots: { Row: ThesisSnapshot; Insert: Partial<ThesisSnapshot> & { user_id: string; symbol: string }; Update: Partial<ThesisSnapshot> };
      earnings_events: { Row: EarningsEvent; Insert: Partial<EarningsEvent> & { user_id: string; symbol: string; report_date: string }; Update: Partial<EarningsEvent> };
      short_interest: { Row: ShortInterestRow; Insert: Partial<ShortInterestRow> & { user_id: string; symbol: string }; Update: Partial<ShortInterestRow> };
      estimate_revisions: { Row: EstimateRevisionRow; Insert: Partial<EstimateRevisionRow> & { user_id: string; symbol: string }; Update: Partial<EstimateRevisionRow> };
      etf_flows: { Row: EtfFlowRow; Insert: Partial<EtfFlowRow> & { user_id: string; symbol: string }; Update: Partial<EtfFlowRow> };
    };
  };
}
