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

export interface ThesisStructured {
  variantView: string;
  setup: string;
  drivers: string[];
  catalysts: ThesisCatalyst[];
  bullCase: ThesisCase;
  bearCase: ThesisCase;
  basePrice: number | null;
  positionRisks: string[];
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
