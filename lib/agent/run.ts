import type { SupabaseClient } from "@supabase/supabase-js";
import { ensureBudget, recordUsage } from "@/lib/billing";
import { getQuotesProvider, getCompanyProfile } from "@/lib/providers/quotes";
import { getOptionsProvider } from "@/lib/providers/options";
import { getShortInterestProvider } from "@/lib/providers/short-interest";
import { getEstimateRevisionsProvider } from "@/lib/providers/estimate-revisions";
import { getNewsProvider } from "@/lib/providers/news";
import type { ThesisAgentOutput, AgentRunSummary, ThesisCatalyst, ThesisCase, ThesisStructured } from "@/lib/types/agent";
import type { ThesisStatus } from "@/lib/types/db";
import { runMultiAgentThesis, type MultiAgentResult, type PipelineContext } from "@/lib/agent/multiAgent";
import { FRAMES, getFrameById, pickFrame, type IndustryFrame } from "@/lib/agent/industryFrames";

interface RunInput {
  symbol: string;
  companyName: string | null;
  userId: string;
  supabase: SupabaseClient;
}

export async function runThesisForSymbol(input: RunInput): Promise<AgentRunSummary> {
  const started = Date.now();
  const { symbol, companyName, userId, supabase } = input;

  // 1a. Resolve the industry frame for this ticker. If the row has sector/
  //     industry stored, use it; otherwise lazy-backfill via Yahoo so future
  //     runs (and the agent prompts here) get the right frame.
  const { data: tickerRow } = await supabase
    .from("tickers")
    .select("id,sector,industry,frame_id,benchmark_symbol")
    .eq("user_id", userId)
    .eq("symbol", symbol)
    .maybeSingle();
  let sector: string | null = (tickerRow as { sector: string | null } | null)?.sector ?? null;
  let industry: string | null = (tickerRow as { industry: string | null } | null)?.industry ?? null;
  let pinnedFrameId: string | null = (tickerRow as { frame_id: string | null } | null)?.frame_id ?? null;
  let pinnedBenchmark: string | null = (tickerRow as { benchmark_symbol: string | null } | null)?.benchmark_symbol ?? null;

  if (!sector && !industry && tickerRow) {
    try {
      const profile = await getCompanyProfile(symbol);
      sector = profile.sector;
      industry = profile.industry;
      const f = pickFrame(sector, industry);
      pinnedFrameId = pinnedFrameId ?? f.id;
      pinnedBenchmark = pinnedBenchmark ?? f.benchmarkSymbol;
      // Backfill so we don't re-query Yahoo next time.
      await supabase
        .from("tickers")
        .update({ sector, industry, frame_id: pinnedFrameId, benchmark_symbol: pinnedBenchmark })
        .eq("id", (tickerRow as { id: string }).id);
    } catch (err) {
      console.warn("lazy industry backfill failed", symbol, err);
    }
  }

  const frame: IndustryFrame = getFrameById(pinnedFrameId) ?? pickFrame(sector, industry);
  const benchmarkSymbol = pinnedBenchmark ?? frame.benchmarkSymbol;

  // 1b. Gather data in parallel — use the frame's benchmark for relative return.
  const [quotes, optionMove, si, rev, news, benchHistory, symbolHistory, prevThesis] = await Promise.all([
    getQuotesProvider().batchQuotes([symbol]),
    getOptionsProvider().impliedMove(symbol),
    getShortInterestProvider().fetch(symbol),
    getEstimateRevisionsProvider().fetch(symbol),
    getNewsProvider().forSymbol(symbol),
    getQuotesProvider().history(benchmarkSymbol, "1mo"),
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
  const relBench = relativeReturn(symbolHistory, benchHistory);
  const previousStatus = (prevThesis.data?.status ?? null) as ThesisStatus | null;

  const ctxForPipeline: PipelineContext = {
    symbol,
    companyName,
    existingThesis: prevThesis.data?.content ?? null,
    existingConviction: prevThesis.data?.conviction ?? null,
    news,
    price: q?.price ?? null,
    changePct: q?.changePct ?? null,
    relativeToBenchmark: relBench,
    impliedMovePct: optionMove.impliedMovePct,
    siPct: si.siPct,
    daysToCover: si.daysToCover,
    revisionDirection: rev.direction,
    asOfIso: new Date().toISOString(),
    frame,
  };

  // 2. Budget check, then run the multi-agent pipeline (3 analysts → bull → bear → PM synthesizer).
  await ensureBudget(supabase, userId);
  const pipeline: MultiAgentResult = await runMultiAgentThesis(ctxForPipeline);

  // We don't get per-call usage from the pipeline today; record an approximate
  // aggregate so the budget tracker reflects the spend. Each pipeline run is
  // ~6 small DeepSeek calls @ ~1500 in / 800 out each.
  await recordUsage(
    {
      userId,
      model: "deepseek-v4-pro",
      endpoint: "agent.thesis.multi",
      usage: {
        input_tokens: 6 * 1500,
        output_tokens: 6 * 800,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
    },
    supabase,
  );

  const output = parseSynthesizedOutput(pipeline.synthesized, news, symbol);

  // 3. Save snapshot — structured fields + the multi-agent debate go into `data`.
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
      // Debate / specialist views — rendered in the drawer for transparency.
      multiAgent: {
        analysts: pipeline.analysts,
        bull: pipeline.bull,
        bear: pipeline.bear,
      },
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

function parseSynthesizedOutput(parsed: Record<string, unknown>, news: { title: string; url: string; publishedAt: string }[], _symbol?: string): ThesisAgentOutput {
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

  // Parse moat block — null if missing or malformed.
  let moat: ThesisStructured["moat"] = null;
  if (parsed.moat && typeof parsed.moat === "object") {
    const m = parsed.moat as Record<string, unknown>;
    const score = clampInt(m.score, 1, 10);
    if (score) {
      moat = {
        score,
        sources: strArray(m.sources, 5),
        durability:
          m.durability === "weakening" || m.durability === "strengthening" ? m.durability : "stable",
        narrative: String(m.narrative ?? "").trim(),
      };
    }
  }

  const structured: ThesisStructured = {
    summary: String(parsed.summary ?? "").trim(),
    variantView: String(parsed.variantView ?? "").trim(),
    setup: String(parsed.setup ?? "").trim(),
    drivers: strArray(parsed.drivers, 8),
    catalysts,
    bullCase: parseCase(parsed.bullCase),
    bearCase: parseCase(parsed.bearCase),
    basePrice: toNumber(parsed.basePrice),
    positionRisks: strArray(parsed.positionRisks, 8),
    moat,
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
