import type { ThesisStatus } from "@/lib/types/db";

export interface ThesisCatalyst {
  date: string;
  event: string;
  expectedDirection: "bullish" | "bearish" | "neutral";
  expectedImpactPct: string;
}

export interface ThesisCase {
  narrative: string;
  targetPrice: number | null;
}

export interface ThesisMoat {
  score: number;           // 1-10, where 1 = no defensible advantage, 10 = dominant durable moat
  sources: string[];       // 2-4 specific sources of advantage (e.g. "switching costs", "network effects")
  durability: "weakening" | "stable" | "strengthening";
  narrative: string;       // 1-2 sentences explaining the score
}

export interface ThesisStructured {
  summary: string;          // 1-2 sentence concise take — what the card shows by default
  variantView: string;
  setup: string;
  drivers: string[];
  catalysts: ThesisCatalyst[];
  bullCase: ThesisCase;
  bearCase: ThesisCase;
  basePrice: number | null;
  positionRisks: string[];
  moat: ThesisMoat | null;  // null when the agent couldn't assess (e.g. ETF, no fundamentals)
}

export interface ThesisAgentOutput {
  status: ThesisStatus;
  conviction: number;
  keyDevelopment: string;
  updatedThesis: string;
  watch: string[];
  riskFlags: string[];
  structured: ThesisStructured;
  sources: Array<{ title: string; url?: string; publishedAt?: string }>;
}

export interface AgentRunSummary {
  symbol: string;
  output: ThesisAgentOutput;
  previousStatus: ThesisStatus | null;
  statusChanged: boolean;
  durationMs: number;
}
