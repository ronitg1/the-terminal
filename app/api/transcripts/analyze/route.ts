import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { analyzeTranscript } from "@/lib/agent/transcriptAnalysis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const BodySchema = z.object({
  symbol: z.string().min(1).max(12).transform((s) => s.toUpperCase()),
  transcript: z.string().min(500, "Transcript must be at least 500 chars (paste the full call)"),
  earnings_event_id: z.string().uuid().optional().nullable(),
  report_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { symbol, transcript, earnings_event_id, report_date } = parsed.data;

  // Budget gate before we send 50K-token transcripts to the model.
  try {
    await ensureBudget(supabase, user.user.id);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message, month: err.month }, { status: 402 });
    }
    throw err;
  }

  // Look up the company name + current thesis + prior transcript analysis.
  const [tickerRes, thesisRes, priorRes] = await Promise.all([
    supabase
      .from("tickers")
      .select("name")
      .eq("user_id", user.user.id)
      .eq("symbol", symbol)
      .maybeSingle(),
    supabase
      .from("thesis_snapshots")
      .select("content")
      .eq("user_id", user.user.id)
      .eq("symbol", symbol)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("transcript_analyses")
      .select("data,sentiment_score,tone_delta,generated_at")
      .eq("user_id", user.user.id)
      .eq("symbol", symbol)
      .order("generated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const companyName = (tickerRes.data as { name: string | null } | null)?.name ?? null;
  const currentThesis = (thesisRes.data as { content: string } | null)?.content ?? null;

  const prior = priorRes.data as
    | { data: Record<string, unknown>; sentiment_score: number | null; tone_delta: string | null; generated_at: string }
    | null;
  const priorAnalysisSummary = prior
    ? `Last quarter (${prior.generated_at.slice(0, 10)}) — sentiment ${prior.sentiment_score ?? "?"}, tone: ${prior.tone_delta ?? "—"}`
    : null;

  // Resolve earnings_event_id if we have report_date but no explicit id.
  let resolvedEarningsEventId = earnings_event_id ?? null;
  if (!resolvedEarningsEventId && report_date) {
    const { data: ev } = await supabase
      .from("earnings_events")
      .select("id")
      .eq("user_id", user.user.id)
      .eq("symbol", symbol)
      .eq("report_date", report_date)
      .maybeSingle();
    resolvedEarningsEventId = (ev as { id: string } | null)?.id ?? null;
  }

  // Run analysis.
  let result;
  try {
    result = await analyzeTranscript({
      symbol,
      companyName,
      transcript,
      currentThesis,
      priorAnalysisSummary,
      asOfIso: new Date().toISOString(),
    });
  } catch (err) {
    console.error("transcript analysis failed", symbol, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // Record spend.
  await recordUsage(
    {
      userId: user.user.id,
      model: result.model,
      endpoint: "agent.transcript",
      usage: result.usage,
    },
    supabase,
  );

  // Persist.
  const { output } = result;
  const insertRow = {
    user_id: user.user.id,
    symbol,
    earnings_event_id: resolvedEarningsEventId,
    raw_transcript: transcript.length > 200_000 ? transcript.slice(0, 200_000) + "…[truncated]" : transcript,
    sentiment_score: output.sentimentScore,
    tone_delta: output.toneDelta,
    key_themes: output.keyThemes,
    dodged_questions: output.dodgedQuestions,
    guidance_language: output.guidanceLanguage,
    data: {
      competitiveMentions: output.competitiveMentions,
      policyMentions: output.policyMentions,
      thesisImpact: output.thesisImpact,
      watchNextQuarter: output.watchNextQuarter,
    },
  };

  const { data: inserted, error: insertErr } = await supabase
    .from("transcript_analyses")
    .insert(insertRow)
    .select("id")
    .single();
  if (insertErr) {
    console.error("transcript_analyses insert failed", symbol, insertErr);
    return NextResponse.json({ error: insertErr.message, analysis: output }, { status: 500 });
  }

  return NextResponse.json({
    id: (inserted as { id: string }).id,
    analysis: output,
  });
}
