// Multi-agent thesis pipeline inspired by TauricResearch/TradingAgents.
// Three parallel specialist analysts → bull/bear debate → PM synthesizer.
// Each step is a focused DeepSeek call; total ~6 calls per ticker, ~$0.012.

import { llmComplete } from "@/lib/llm";
import { parseLenientJson } from "@/lib/agent/jsonRepair";
import { FRAMES, type IndustryFrame } from "@/lib/agent/industryFrames";

// ---------------------------------------------------------------------------
// Shared input the whole pipeline sees
// ---------------------------------------------------------------------------

export interface PipelineContext {
  symbol: string;
  companyName: string | null;
  asOfIso: string;
  price: number | null;
  changePct: number | null;
  relativeToBenchmark: number | null;     // % vs frame.benchmarkSymbol over 1 month
  impliedMovePct: number | null;
  siPct: number | null;
  daysToCover: number | null;
  revisionDirection: string | null;
  news: Array<{ title: string; source: string | null; publishedAt: string; description: string | null; url: string }>;
  existingThesis: string | null;
  existingConviction: number | null;
  frame: IndustryFrame;                   // industry frame for this ticker
}

// ---------------------------------------------------------------------------
// Analyst outputs
// ---------------------------------------------------------------------------

export type SignalQuality = "bullish" | "bearish" | "mixed" | "noise";

export interface AnalystOutput {
  perspective: "news" | "technicals" | "fundamentals";
  signalQuality: SignalQuality;
  summary: string;
  bullets: string[];
}

export interface ResearcherOutput {
  stance: "bull" | "bear";
  thesis: string;
  targetPrice: number | null;
  mustBeTrue: string[];
  confidence: number;
}

export interface MultiAgentResult {
  analysts: AnalystOutput[];
  bull: ResearcherOutput;
  bear: ResearcherOutput;
  // The structured PM thesis the existing UI already knows how to render.
  // Returned as a generic record because the synthesizer prompt mirrors the
  // existing thesis schema and run.ts handles strict shape validation.
  synthesized: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Phase 1 — specialist analysts (run in parallel)
// ---------------------------------------------------------------------------

const ANALYST_SYSTEM = (perspective: string, focus: string, frame: IndustryFrame) => `You are the ${perspective} analyst, ${frame.personaContext} Your reader is the PM who will synthesize your view with the other analysts.

Focus exclusively on: ${focus}

Domain context you should assume (don't re-explain): ${frame.domainKnowledge.length > 0 ? frame.domainKnowledge.join("; ") : "standard equity fundamentals"}.
Key metrics that matter for this sector: ${frame.keyMetrics.join(", ")}.

Be terse. Output JSON ONLY:
{
  "signalQuality": "bullish" | "bearish" | "mixed" | "noise",
  "summary": "2-3 sentence read on what your perspective says about this ticker right now",
  "bullets": ["3-5 specific observations from your perspective — single line each, concrete numbers/dates"]
}

No preamble, no markdown fences.`;

async function runAnalyst(
  perspective: "news" | "technicals" | "fundamentals",
  systemPrompt: string,
  userPrompt: string,
): Promise<AnalystOutput> {
  const completion = await llmComplete({
    purpose: "thesis",
    system: systemPrompt,
    user: userPrompt,
    maxTokens: 800,
    jsonResponse: true,
  });
  const parsed = parseLenientJson<Record<string, unknown>>(completion.text);
  return {
    perspective,
    signalQuality: normalizeSignal(parsed.signalQuality),
    summary: String(parsed.summary ?? "").trim(),
    bullets: Array.isArray(parsed.bullets) ? parsed.bullets.map(String).filter(Boolean).slice(0, 6) : [],
  };
}

function newsAnalystPrompt(ctx: PipelineContext): string {
  const news =
    ctx.news.length === 0
      ? "(no news in the last 24h)"
      : ctx.news
          .slice(0, 12)
          .map((n, i) => `[${i + 1}] ${n.title} — ${n.source ?? "?"} (${n.publishedAt.slice(0, 10)})${n.description ? `\n   ${n.description}` : ""}`)
          .join("\n");
  const policyThemes =
    ctx.frame.policyThemes.length > 0
      ? ctx.frame.policyThemes.map((t) => `- ${t}`).join("\n")
      : "(no sector-specific policy themes)";
  return `TICKER: ${ctx.symbol}${ctx.companyName ? ` (${ctx.companyName})` : ""}
SECTOR FRAME: ${ctx.frame.label}
AS OF: ${ctx.asOfIso}

RECENT NEWS (last 24h):
${news}

What does the news flow say about this ticker, its sector, and the policy backdrop relevant to ${ctx.frame.label}?

POLICY THEMES TO MONITOR (only flag if actually relevant):
${policyThemes}

Also surface any management or competitor headlines and any data points that move the needle for this name.`;
}

function technicalsAnalystPrompt(ctx: PipelineContext): string {
  return `TICKER: ${ctx.symbol}${ctx.companyName ? ` (${ctx.companyName})` : ""}
SECTOR FRAME: ${ctx.frame.label}
AS OF: ${ctx.asOfIso}

MARKET STATE:
- Spot: ${fmt(ctx.price)}
- Day move: ${fmtPct(ctx.changePct)}
- Relative to ${ctx.frame.benchmarkSymbol} (${ctx.frame.benchmarkLabel}, 1mo): ${fmtPct(ctx.relativeToBenchmark)}
- ATM straddle implied move: ${fmtPct(ctx.impliedMovePct)}
- Short interest: ${fmtPct(ctx.siPct)} of float${ctx.daysToCover != null ? `, ${ctx.daysToCover.toFixed(1)} days to cover` : ""}

What does the market structure say? Focus on positioning (cheap/expensive IV vs history), short squeeze potential, relative strength vs ${ctx.frame.benchmarkSymbol}, and any flow signals.`;
}

function fundamentalsAnalystPrompt(ctx: PipelineContext): string {
  return `TICKER: ${ctx.symbol}${ctx.companyName ? ` (${ctx.companyName})` : ""}
AS OF: ${ctx.asOfIso}

ESTIMATE DATA:
- Current-quarter revision trend (30d): ${ctx.revisionDirection ?? "unknown"}
- Prior thesis (conviction ${ctx.existingConviction ?? "—"}/10):
${ctx.existingThesis?.trim() || "(no prior thesis on record)"}

What do estimate revisions, consensus positioning, and the prior thesis tell us about where buyside expectations sit relative to sellside? Where is the variant view? What does the model know that consensus doesn't, or vice versa?`;
}

// ---------------------------------------------------------------------------
// Phase 2 — bull / bear debate (sequential)
// ---------------------------------------------------------------------------

const RESEARCHER_SYSTEM = (stance: "bull" | "bear") => `You are the ${stance.toUpperCase()} researcher on a discretionary equity desk. The PM will compare your case to the opposing researcher's case before reaching a final view.

Your job: ${stance === "bull" ? "Steelman the LONG case for this ticker." : "Steelman the SHORT / bearish case, deliberately rebutting the bull case where it's weak."}

Be specific. Use the analyst outputs to anchor concrete claims. Output JSON ONLY:
{
  "thesis": "2-3 sentences. State the ${stance} case directly, no hedging.",
  "targetPrice": <number — your ${stance === "bull" ? "upside target" : "downside target"} for the next 90 days>,
  "mustBeTrue": ["3 specific things that have to ${stance === "bull" ? "happen" : "break"} for this case to play out"],
  "confidence": <1-10 integer>
}

No preamble, no markdown fences. Do NOT acknowledge or echo the prompt.`;

async function runResearcher(
  stance: "bull" | "bear",
  ctx: PipelineContext,
  analysts: AnalystOutput[],
  bullCaseToCounter: ResearcherOutput | null = null,
): Promise<ResearcherOutput> {
  const analystSummary = analysts
    .map((a) => `### ${a.perspective.toUpperCase()} ANALYST (${a.signalQuality})\n${a.summary}\nBullets:\n${a.bullets.map((b) => `- ${b}`).join("\n")}`)
    .join("\n\n");

  const opposingBlock = bullCaseToCounter
    ? `\n\n### OPPOSING BULL CASE TO REBUT\n${bullCaseToCounter.thesis}\nBull target: $${bullCaseToCounter.targetPrice ?? "?"}\nMust be true: ${bullCaseToCounter.mustBeTrue.join("; ")}`
    : "";

  const userPrompt = `TICKER: ${ctx.symbol}${ctx.companyName ? ` (${ctx.companyName})` : ""}
AS OF: ${ctx.asOfIso}
SPOT: ${fmt(ctx.price)}

ANALYST VIEWS:

${analystSummary}${opposingBlock}

Build the ${stance.toUpperCase()} case now.`;

  const completion = await llmComplete({
    purpose: "thesis",
    system: RESEARCHER_SYSTEM(stance),
    user: userPrompt,
    maxTokens: 800,
    jsonResponse: true,
  });
  const parsed = parseLenientJson<Record<string, unknown>>(completion.text);
  return {
    stance,
    thesis: String(parsed.thesis ?? "").trim(),
    targetPrice: toNumber(parsed.targetPrice),
    mustBeTrue: Array.isArray(parsed.mustBeTrue)
      ? parsed.mustBeTrue.map(String).filter(Boolean).slice(0, 5)
      : [],
    confidence: clampInt(parsed.confidence, 1, 10),
  };
}

// ---------------------------------------------------------------------------
// Phase 3 — PM synthesizer (final structured thesis)
// ---------------------------------------------------------------------------

const SYNTHESIZER_SYSTEM = `You are the portfolio manager. Three analysts and two researchers (bull + bear) have given you their views. Synthesize the final thesis — not a sum, a judgment.

Output JSON ONLY — mirrors the existing thesis schema. Be concise; the UI renders structured sections separately.

{
  "status": "intact" | "strengthened" | "weakened" | "broken",
  "conviction": 1-10 integer (your synthesis, NOT an average of bull/bear confidences),
  "keyDevelopment": "1-2 sentences. The single most important fact driving your view.",
  "variantView": "2-3 sentences. The differentiated take vs sellside / market consensus.",
  "setup": "2-4 sentences. How the stock is positioned into the next print.",
  "drivers": ["3-5 bullets. Specific, not generic."],
  "catalysts": [
    {"date": "YYYY-MM-DD or 'Q3 2026' or 'next 30d'", "event": "specific event", "expectedDirection": "bullish"|"bearish"|"neutral", "expectedImpactPct": "+5-8% or -10%"}
  ],
  "bullCase": { "narrative": "2-3 sentences from your synthesis (not just echoing bull researcher).", "targetPrice": 250 },
  "bearCase": { "narrative": "2-3 sentences from your synthesis.", "targetPrice": 80 },
  "basePrice": 195,
  "positionRisks": ["3-5 bullets. Quantified where possible."],
  "watch": ["3-5 specific items to monitor before next print."],
  "sources": [{"title": "...", "url": "...", "publishedAt": "ISO date"}]
}

Do not include narrative outside the JSON. Conviction must reflect the weight of evidence: if bull/bear are evenly matched, conviction sits 4-6; if one clearly dominates, weight toward that side. Status is your honest call.`;

async function runSynthesizer(
  ctx: PipelineContext,
  analysts: AnalystOutput[],
  bull: ResearcherOutput,
  bear: ResearcherOutput,
): Promise<Record<string, unknown>> {
  const analystBlock = analysts
    .map((a) => `### ${a.perspective.toUpperCase()} ANALYST (${a.signalQuality})\n${a.summary}\n${a.bullets.map((b) => `- ${b}`).join("\n")}`)
    .join("\n\n");

  const newsSources = ctx.news.slice(0, 6).map((n) => ({ title: n.title, url: n.url, publishedAt: n.publishedAt }));

  const userPrompt = `TICKER: ${ctx.symbol}${ctx.companyName ? ` (${ctx.companyName})` : ""}
SECTOR FRAME: ${ctx.frame.label} (benchmark ${ctx.frame.benchmarkSymbol})
AS OF: ${ctx.asOfIso}
SPOT: ${fmt(ctx.price)} (day ${fmtPct(ctx.changePct)})
1mo vs ${ctx.frame.benchmarkSymbol}: ${fmtPct(ctx.relativeToBenchmark)}
IV implied move: ${fmtPct(ctx.impliedMovePct)} | SI ${fmtPct(ctx.siPct)} | rev trend ${ctx.revisionDirection ?? "unknown"}

PRIOR THESIS:
${ctx.existingThesis?.trim() || "(none — produce initial thesis)"}

## ANALYST VIEWS

${analystBlock}

## BULL CASE
${bull.thesis}
Target: $${bull.targetPrice ?? "?"} | Confidence ${bull.confidence}/10
Must be true: ${bull.mustBeTrue.join("; ")}

## BEAR CASE
${bear.thesis}
Target: $${bear.targetPrice ?? "?"} | Confidence ${bear.confidence}/10
Must be true: ${bear.mustBeTrue.join("; ")}

## AVAILABLE NEWS SOURCES
${JSON.stringify(newsSources)}

Produce the PM-grade synthesis JSON now. Use the news sources above for the "sources" field.`;

  const completion = await llmComplete({
    purpose: "thesis",
    system: SYNTHESIZER_SYSTEM,
    user: userPrompt,
    maxTokens: 3000,
    jsonResponse: true,
  });
  return parseLenientJson<Record<string, unknown>>(completion.text);
}

// ---------------------------------------------------------------------------
// Pipeline entry point
// ---------------------------------------------------------------------------

export async function runMultiAgentThesis(ctx: PipelineContext): Promise<MultiAgentResult> {
  const policyFocus =
    ctx.frame.policyThemes.length > 0
      ? `${ctx.frame.policyThemes.slice(0, 3).join(", ")}, and management/competitor headlines`
      : "management and competitor headlines, and any macro policy that's actually relevant to this ticker's industry";

  // Phase 1: 3 analysts in parallel.
  const [newsA, techA, fundA] = await Promise.all([
    runAnalyst(
      "news",
      ANALYST_SYSTEM("news", `company + sector + policy news in the last 24h. ${policyFocus}.`, ctx.frame),
      newsAnalystPrompt(ctx),
    ),
    runAnalyst(
      "technicals",
      ANALYST_SYSTEM(
        "technicals + positioning",
        `spot vs recent range, implied volatility relative to history, short interest dynamics, options flow, relative strength vs ${ctx.frame.benchmarkSymbol} (${ctx.frame.benchmarkLabel}).`,
        ctx.frame,
      ),
      technicalsAnalystPrompt(ctx),
    ),
    runAnalyst(
      "fundamentals",
      ANALYST_SYSTEM(
        "fundamentals + estimate revisions",
        "consensus EPS / revenue trajectory, recent revision direction, buyside vs sellside positioning, balance sheet, margin trajectory.",
        ctx.frame,
      ),
      fundamentalsAnalystPrompt(ctx),
    ),
  ]);

  const analysts = [newsA, techA, fundA];

  // Phase 2: bull first, then bear (bear sees bull case to counter).
  const bull = await runResearcher("bull", ctx, analysts);
  const bear = await runResearcher("bear", ctx, analysts, bull);

  // Phase 3: PM synthesizer.
  const synthesized = await runSynthesizer(ctx, analysts, bull, bear);

  return { analysts, bull, bear, synthesized };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function normalizeSignal(v: unknown): SignalQuality {
  const s = String(v ?? "").toLowerCase().trim();
  if (s === "bullish" || s === "bearish" || s === "mixed" || s === "noise") return s;
  return "mixed";
}
function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}
function clampInt(v: unknown, min: number, max: number): number {
  const i = Number.parseInt(String(v), 10);
  if (!Number.isFinite(i)) return min;
  return Math.min(max, Math.max(min, i));
}
function fmt(n: number | null): string {
  return n == null || !Number.isFinite(n) ? "n/a" : n.toFixed(2);
}
function fmtPct(n: number | null): string {
  return n == null || !Number.isFinite(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
