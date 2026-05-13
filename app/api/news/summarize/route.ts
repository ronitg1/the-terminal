// Summarize a single news article via the active LLM. Tries to extract the
// article body using Tavily extract (advanced), then asks the model for 3
// bullets + a book-relevance rating.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { llmComplete } from "@/lib/llm";
import { tavilyExtract } from "@/lib/providers/tavily";
import { parseLenientJson } from "@/lib/agent/jsonRepair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  url: z.string().url(),
  title: z.string().min(1).max(500),
  description: z.string().nullable().optional(),
  relatedSymbol: z.string().nullable().optional(),
});

const SYSTEM = `You are an analyst summarizing news for a discretionary investor running real risk. The investor's book may span any sector — adapt your relevance lens to whatever sectors the related ticker (or macro topic) touches.

Output JSON ONLY — no prose, no fences:
{
  "summary": ["3 bullets, single sentence each. Focus on the WHAT and the WHY-it-matters. Skip headlines they already know."],
  "relevance": "high" | "medium" | "low",
  "relevanceReason": "1 sentence: why does this matter (or not) to this investor's book?"
}

Be terse. Skip generic disclaimers.`;

export async function POST(req: NextRequest) {
  const supabase = createServerSupabase();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return new NextResponse("Unauthorized", { status: 401 });

  const body = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  try {
    await ensureBudget(supabase, user.user.id);
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return NextResponse.json({ error: err.message, month: err.month }, { status: 402 });
    }
    throw err;
  }

  const { url, title, description, relatedSymbol } = parsed.data;

  // Try to pull the article body. Tavily often fails on paywalled / cookie-walled
  // sites — falling back to title + description is fine for a quick summary.
  let body_text: string | null = null;
  try {
    const ext = await tavilyExtract(url, { depth: "advanced" });
    if (ext.rawContent && ext.rawContent.length > 300) {
      body_text = ext.rawContent.slice(0, 12_000); // cap to keep cost down
    }
  } catch {
    // ignore — we'll work with just title+description
  }

  const userPrompt = [
    `RELATED TICKER: ${relatedSymbol ?? "none — macro/sector article"}`,
    `ARTICLE TITLE: ${title}`,
    description ? `DESCRIPTION: ${description}` : "",
    body_text ? `\nARTICLE BODY:\n${body_text}` : "",
    "",
    "Produce the JSON summary now.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const completion = await llmComplete({
      purpose: "thesis",
      system: SYSTEM,
      user: userPrompt,
      maxTokens: 800,
      jsonResponse: true,
    });
    await recordUsage(
      {
        userId: user.user.id,
        model: completion.model,
        endpoint: "news.summarize",
        usage: completion.usage,
      },
      supabase,
    );
    const parsedOut = parseLenientJson<{
      summary?: string[];
      relevance?: "high" | "medium" | "low";
      relevanceReason?: string;
    }>(completion.text);
    return NextResponse.json({
      summary: Array.isArray(parsedOut.summary) ? parsedOut.summary.map(String).slice(0, 5) : [],
      relevance: parsedOut.relevance ?? "medium",
      relevanceReason: parsedOut.relevanceReason ?? "",
      hadFullBody: body_text !== null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
