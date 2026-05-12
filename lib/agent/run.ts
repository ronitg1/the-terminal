import type { SupabaseClient } from "@supabase/supabase-js";
import { llmComplete } from "@/lib/llm";
import { ensureBudget, recordUsage } from "@/lib/billing";
import { THESIS_SYSTEM_PROMPT, buildThesisUserPrompt } from "@/lib/agent/thesisPrompt";
import { getQuotesProvider } from "@/lib/providers/quotes";
import { getOptionsProvider } from "@/lib/providers/options";
import { getShortInterestProvider } from "@/lib/providers/short-interest";
import { getEstimateRevisionsProvider } from "@/lib/providers/estimate-revisions";
import { getNewsProvider } from "@/lib/providers/news";
import type { ThesisAgentOutput, AgentRunSummary, ThesisCatalyst, ThesisCase, ThesisStructured } from "@/lib/types/agent";
import type { ThesisStatus } from "@/lib/types/db";
import { parseLenientJson } from "@/lib/agent/jsonRepair";

interface RunInput {
  symbol: string;
  companyName: string | null;
  userId: string;
  supabase: SupabaseClient;
}

export async function runThesisForSymbol(input: RunInput): Promise<AgentRunSummary> {
  const started = Date.now();
  const { symbol, companyName, userId, supabase } = input;

  // 1. Gather context in parallel.
  const [quotes, optionMove, si, rev, news, iclnHistory, symbolHistory, prevThesis] = await Promise.all([
    getQuotesProvider().batchQuotes([symbol]),
    getOptionsProvider().impliedMove(symbol),
    getShortInterestProvider().fetch(symbol),
    getEstimateRevisionsProvider().fetch(symbol),
    getNewsProvider().forSymbol(symbol),
    getQuotesProvider().history("ICLN", "1mo"),
    getQuotesProvider().history(symbol, "1mo"),
    supabase
      .from("thesis_snapshots")
      .select("content,conviction,status,generated_at")
      .eq("user_id", userId)
      .eq("symbol", symbol)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const q = quotes[0] ?? null;
  const relICLN = relativeReturn(symbolHistory, iclnHistory);
  const previousStatus = (prevThesis.data?.status ?? null) as ThesisStatus | null;

  const userPrompt = buildThesisUserPrompt({
    symbol,
    companyName,
    existingThesis: prevThesis.data?.content ?? null,
    existingConviction: prevThesis.data?.conviction ?? null,
    news,
    price: q?.price ?? null,
    changePct: q?.changePct ?? null,
    relativeToICLN: relICLN,
    impliedMovePct: optionMove.impliedMovePct,
    siPct: si.siPct,
    daysToCover: si.daysToCover,
    revisionDirection: rev.direction,
    asOfIso: new Date().toISOString(),
  });

  // 2. Budget check, then call the active LLM provider.
  await ensureBudget(supabase, userId);
  const completion = await llmComplete({
    purpose: "thesis",
    system: THESIS_SYSTEM_PROMPT,
    user: userPrompt,
    maxTokens: 4096,
    jsonResponse: true,
  });

  await recordUsage(
    {
      userId,
      model: completion.model,
      endpoint: "agent.thesis",
      usage: completion.usage,
    },
    supabase,
  );

  const output = parseThesisOutput(completion.text, news, symbol);

  // 3. Save snapshot — structured fields go into the new `data` jsonb column.
  const { error: insertErr } = await supabase.from("thesis_snapshots").insert({
    user_id: userId,
    symbol,
    content: output.updatedThesis,
    sources: output.sources,
    data: {
      keyDevelopment: output.keyDevelopment,
      watch: output.watch,
      riskFlags: output.riskFlags,
      structured: output.structured,
    },
    status: output.status,
    conviction: output.conviction,
  });
  if (insertErr) {
    console.error("thesis_snapshots insert failed", symbol, insertErr);
  }

  return {
    symbol,
    output,
    previousStatus,
    statusChanged: previousStatus !== null && previousStatus !== output.status,
    durationMs: Date.now() - started,
  };
}

function parseThesisOutput(raw: string, news: { title: string; url: string; publishedAt: string }[], symbol?: string): ThesisAgentOutput {
  let parsed: any;
  try {
    parsed = parseLenientJson(raw);
  } catch (err) {
    console.error(`[thesis ${symbol ?? "?"}] lenient JSON parse failed. Raw tail:`, raw.slice(-600));
    throw err instanceof Error ? err : new Error(String(err));
  }

  const status = normalizeStatus(parsed.status);
  const conviction = clampInt(parsed.conviction, 1, 10);
  const watch = strArray(parsed.watch, 8);
  const riskFlags = strArray(parsed.riskFlags ?? parsed.positionRisks, 8);
  const sources = Array.isArray(parsed.sources)
    ? parsed.sources
        .filter((s: any) => s && typeof s.title === "string")
        .slice(0, 8)
        .map((s: any) => ({ title: String(s.title), url: s.url ? String(s.url) : undefined, publishedAt: s.publishedAt ? String(s.publishedAt) : undefined }))
    : news.slice(0, 5).map((n) => ({ title: n.title, url: n.url, publishedAt: n.publishedAt }));

  const catalysts: ThesisCatalyst[] = Array.isArray(parsed.catalysts)
    ? parsed.catalysts
        .filter((c: any) => c && (typeof c.event === "string" || typeof c.date === "string"))
        .slice(0, 10)
        .map((c: any) => ({
          date: String(c.date ?? "").trim(),
          event: String(c.event ?? "").trim(),
          expectedDirection:
            c.expectedDirection === "bullish" || c.expectedDirection === "bearish" || c.expectedDirection === "neutral"
              ? c.expectedDirection
              : "neutral",
          expectedImpactPct: String(c.expectedImpactPct ?? "").trim(),
        }))
    : [];

  const parseCase = (raw: any): ThesisCase => ({
    narrative: String(raw?.narrative ?? "").trim(),
    targetPrice: toNumber(raw?.targetPrice),
  });

  const structured: ThesisStructured = {
    variantView: String(parsed.variantView ?? "").trim(),
    setup: String(parsed.setup ?? "").trim(),
    drivers: strArray(parsed.drivers, 8),
    catalysts,
    bullCase: parseCase(parsed.bullCase),
    bearCase: parseCase(parsed.bearCase),
    basePrice: toNumber(parsed.basePrice),
    positionRisks: strArray(parsed.positionRisks, 8),
  };

  // Build a markdown `content` body server-side from the structured fields.
  // The model no longer produces a separate narrative — keeps output shorter,
  // avoids duplicate effort, and avoids truncation.
  const keyDevelopment = String(parsed.keyDevelopment ?? "").trim();
  const updatedThesis = buildContentMarkdown({ keyDevelopment, structured, watch });

  return {
    status,
    conviction,
    keyDevelopment,
    updatedThesis,
    watch,
    riskFlags,
    structured,
    sources,
  };
}

function strArray(v: unknown, max: number): string[] {
  return Array.isArray(v) ? v.map(String).map((s) => s.trim()).filter(Boolean).slice(0, max) : [];
}

function buildContentMarkdown(p: {
  keyDevelopment: string;
  structured: ThesisStructured;
  watch: string[];
}): string {
  const { keyDevelopment, structured, watch } = p;
  const parts: string[] = [];
  if (keyDevelopment) parts.push(`**${keyDevelopment}**`);
  if (structured.variantView) parts.push(`## Variant view\n\n${structured.variantView}`);
  if (structured.setup) parts.push(`## Setup into print\n\n${structured.setup}`);

  const bull = structured.bullCase;
  const bear = structured.bearCase;
  const bp = structured.basePrice != null ? ` · base $${structured.basePrice}` : "";
  const bullTarget = bull.targetPrice != null ? ` (target $${bull.targetPrice})` : "";
  const bearTarget = bear.targetPrice != null ? ` (target $${bear.targetPrice})` : "";
  if (bull.narrative || bear.narrative) {
    parts.push(
      `## Bull / bear${bp}\n\n**Bull${bullTarget}:** ${bull.narrative || "—"}\n\n**Bear${bearTarget}:** ${bear.narrative || "—"}`,
    );
  }

  if (structured.drivers.length > 0) {
    parts.push(`## Drivers\n\n${structured.drivers.map((d) => `- ${d}`).join("\n")}`);
  }
  if (structured.catalysts.length > 0) {
    parts.push(
      `## Catalysts\n\n${structured.catalysts
        .map((c) => `- **${c.date || "—"}** ${c.event} (${c.expectedDirection}, ${c.expectedImpactPct})`)
        .join("\n")}`,
    );
  }
  if (structured.positionRisks.length > 0) {
    parts.push(`## Position risks\n\n${structured.positionRisks.map((r) => `- ${r}`).join("\n")}`);
  }
  if (watch.length > 0) {
    parts.push(`## What I'm watching\n\n${watch.map((w) => `- ${w}`).join("\n")}`);
  }
  return parts.join("\n\n");
}
function toNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseFloat(v.replace(/[$,]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeStatus(s: any): ThesisStatus {
  const v = String(s ?? "").toLowerCase().trim();
  if (v === "intact" || v === "strengthened" || v === "weakened" || v === "broken") return v;
  return "intact";
}

function clampInt(n: any, min: number, max: number): number {
  const i = Number.parseInt(String(n), 10);
  if (!Number.isFinite(i)) return min;
  return Math.min(max, Math.max(min, i));
}

function relativeReturn(
  symbolHistory: { date: string; close: number }[],
  benchHistory: { date: string; close: number }[],
): number | null {
  if (symbolHistory.length < 2 || benchHistory.length < 2) return null;
  const sStart = symbolHistory[0].close;
  const sEnd = symbolHistory[symbolHistory.length - 1].close;
  const bStart = benchHistory[0].close;
  const bEnd = benchHistory[benchHistory.length - 1].close;
  if (sStart <= 0 || bStart <= 0) return null;
  const sRet = (sEnd / sStart - 1) * 100;
  const bRet = (bEnd / bStart - 1) * 100;
  return sRet - bRet;
}
