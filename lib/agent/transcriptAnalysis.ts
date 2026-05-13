// Earnings call transcript analysis. Single deep-analysis call: the model gets
// the full transcript + current thesis + (optionally) the prior quarter's
// analysis for sentiment-delta scoring, and returns structured JSON across
// nine sections defined in the spec.

import { llmComplete } from "@/lib/llm";
import { parseLenientJson } from "@/lib/agent/jsonRepair";

export interface KeyTheme {
  topic: string;
  quote: string;
  bookRelevance: "high" | "medium" | "low";
}

export interface DodgedQuestion {
  analyst: string;     // who asked (firm / name if available, else "Analyst")
  question: string;    // 1-line paraphrase
  pivot: string;       // what management said instead
  importance: "high" | "medium" | "low";
}

export interface CompetitiveMention {
  competitor: string;
  context: string;
  signal: "bullish" | "bearish" | "neutral";
}

export interface PolicyMention {
  topic: string;       // "IRA 45X", "FEOC", "Section 201", etc.
  quote: string;       // exact language
  interpretation: string;
}

export interface TranscriptAnalysisOutput {
  sentimentScore: number;          // -10..+10 vs last quarter
  toneDelta: string;               // "more cautious" | "more confident" | "similar" + cited language
  keyThemes: KeyTheme[];
  guidanceLanguage: string;        // language used + hedging words flagged
  dodgedQuestions: DodgedQuestion[];
  competitiveMentions: CompetitiveMention[];
  policyMentions: PolicyMention[];
  thesisImpact: {
    direction: "confirms" | "strengthens" | "weakens" | "breaks";
    narrative: string;
  };
  watchNextQuarter: string[];
}

const SYSTEM = `You are a senior equity analyst breaking down an earnings call transcript for a discretionary investor. Your reader is a sophisticated portfolio manager — do not explain industry mechanics, just flag and interpret what's signal vs noise. Adapt your sector focus to whatever industry the company operates in.

Extract structured information from the transcript. Be terse, specific, and quote exact language whenever possible.

Output JSON ONLY — no prose, no markdown fences. Schema:

{
  "sentimentScore": <-10..+10 integer — vs prior quarter if provided, else absolute 0=neutral>,
  "toneDelta": "1-2 sentences. More cautious / more confident / similar, with exact phrases that show it.",
  "keyThemes": [
    {
      "topic": "Short label, e.g. 'Polysilicon ASP pressure'",
      "quote": "<15-word representative quote",
      "bookRelevance": "high" | "medium" | "low"
    }
  ],
  "guidanceLanguage": "Exact forward-guidance language. Flag hedging ('approximately', 'subject to', 'assuming', 'we expect, if...') vs confident language. Cite the words.",
  "dodgedQuestions": [
    {
      "analyst": "Firm or analyst name if stated, else 'Analyst'",
      "question": "1-line paraphrase of the question",
      "pivot": "What management said instead",
      "importance": "high" | "medium" | "low"
    }
  ],
  "competitiveMentions": [
    {
      "competitor": "Specific company name or 'Chinese modules' etc.",
      "context": "What was said and why it matters",
      "signal": "bullish" | "bearish" | "neutral"
    }
  ],
  "policyMentions": [
    {
      "topic": "IRA 45X / FEOC / Section 201 / etc.",
      "quote": "Exact words from management",
      "interpretation": "What this implies for the position"
    }
  ],
  "thesisImpact": {
    "direction": "confirms" | "strengthens" | "weakens" | "breaks",
    "narrative": "1 paragraph: does this transcript confirm, strengthen, weaken, or break the current thesis? Cite the deciding evidence."
  },
  "watchNextQuarter": ["2-3 specific things to monitor based on what management flagged"]
}

Rules:
- Include top 3-5 key themes (not 10+); the PM wants signal density.
- Dodged questions are HIGH value — include any analyst question that received a non-answer or pivot, with importance: high if it was strategic, medium otherwise.
- If the prior-quarter analysis is provided, sentimentScore must be the delta vs that. If not, ground it in absolute tone.
- Quotes must be from the transcript verbatim; do NOT paraphrase.`;

export interface TranscriptAnalysisInput {
  symbol: string;
  companyName?: string | null;
  transcript: string;
  currentThesis?: string | null;
  priorAnalysisSummary?: string | null;
  asOfIso: string;
}

export async function analyzeTranscript(input: TranscriptAnalysisInput): Promise<{
  output: TranscriptAnalysisOutput;
  model: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
}> {
  const userPrompt = [
    `TICKER: ${input.symbol}${input.companyName ? ` (${input.companyName})` : ""}`,
    `AS OF: ${input.asOfIso}`,
    "",
    "CURRENT THESIS:",
    input.currentThesis?.trim() || "(no thesis on record)",
    "",
    "PRIOR-QUARTER ANALYSIS (for sentiment delta):",
    input.priorAnalysisSummary?.trim() || "(no prior analysis on record — score sentiment in absolute terms)",
    "",
    "TRANSCRIPT:",
    input.transcript,
    "",
    "Produce the structured JSON analysis now.",
  ].join("\n");

  const completion = await llmComplete({
    purpose: "thesis", // routed through the existing model selection
    system: SYSTEM,
    user: userPrompt,
    maxTokens: 6000,
    jsonResponse: true,
  });

  const raw = parseLenientJson<Record<string, any>>(completion.text);
  const output: TranscriptAnalysisOutput = {
    sentimentScore: clampInt(raw.sentimentScore, -10, 10),
    toneDelta: String(raw.toneDelta ?? "").trim(),
    keyThemes: arrayOf(raw.keyThemes, parseKeyTheme, 8),
    guidanceLanguage: String(raw.guidanceLanguage ?? "").trim(),
    dodgedQuestions: arrayOf(raw.dodgedQuestions, parseDodged, 10),
    competitiveMentions: arrayOf(raw.competitiveMentions, parseCompetitive, 10),
    policyMentions: arrayOf(raw.policyMentions, parsePolicy, 10),
    thesisImpact: parseThesisImpact(raw.thesisImpact),
    watchNextQuarter: strArray(raw.watchNextQuarter, 5),
  };

  return { output, model: completion.model, usage: completion.usage };
}

// ---------------------------------------------------------------------------
// Parsers — defensive shape conversion from the model's JSON
// ---------------------------------------------------------------------------

function parseKeyTheme(r: any): KeyTheme | null {
  if (!r || typeof r.topic !== "string") return null;
  return {
    topic: r.topic.trim(),
    quote: String(r.quote ?? "").trim(),
    bookRelevance: normRelevance(r.bookRelevance),
  };
}
function parseDodged(r: any): DodgedQuestion | null {
  if (!r || typeof r.question !== "string") return null;
  return {
    analyst: String(r.analyst ?? "Analyst").trim() || "Analyst",
    question: r.question.trim(),
    pivot: String(r.pivot ?? "").trim(),
    importance: normRelevance(r.importance),
  };
}
function parseCompetitive(r: any): CompetitiveMention | null {
  if (!r || typeof r.competitor !== "string") return null;
  return {
    competitor: r.competitor.trim(),
    context: String(r.context ?? "").trim(),
    signal: normSignal(r.signal),
  };
}
function parsePolicy(r: any): PolicyMention | null {
  if (!r || typeof r.topic !== "string") return null;
  return {
    topic: r.topic.trim(),
    quote: String(r.quote ?? "").trim(),
    interpretation: String(r.interpretation ?? "").trim(),
  };
}
function parseThesisImpact(r: any): TranscriptAnalysisOutput["thesisImpact"] {
  return {
    direction: normDirection(r?.direction),
    narrative: String(r?.narrative ?? "").trim(),
  };
}

function arrayOf<T>(v: unknown, parse: (x: any) => T | null, max: number): T[] {
  if (!Array.isArray(v)) return [];
  return v.map(parse).filter((x): x is T => x !== null).slice(0, max);
}
function strArray(v: unknown, max: number): string[] {
  return Array.isArray(v) ? v.map((x) => String(x).trim()).filter(Boolean).slice(0, max) : [];
}
function clampInt(v: unknown, lo: number, hi: number): number {
  const n = Number.parseInt(String(v), 10);
  if (!Number.isFinite(n)) return 0;
  return Math.min(hi, Math.max(lo, n));
}
function normRelevance(v: unknown): "high" | "medium" | "low" {
  const s = String(v ?? "").toLowerCase().trim();
  return s === "high" || s === "medium" || s === "low" ? s : "medium";
}
function normSignal(v: unknown): "bullish" | "bearish" | "neutral" {
  const s = String(v ?? "").toLowerCase().trim();
  return s === "bullish" || s === "bearish" || s === "neutral" ? s : "neutral";
}
function normDirection(v: unknown): "confirms" | "strengthens" | "weakens" | "breaks" {
  const s = String(v ?? "").toLowerCase().trim();
  return s === "confirms" || s === "strengthens" || s === "weakens" || s === "breaks" ? s : "confirms";
}
