// Extracts structured items from a free-form journal entry: trade ideas (with
// tickers), thesis changes, action items, and risks flagged.

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createServerSupabase } from "@/lib/supabase/server";
import { BudgetExceededError, ensureBudget, recordUsage } from "@/lib/billing";
import { llmComplete } from "@/lib/llm";
import { parseLenientJson } from "@/lib/agent/jsonRepair";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const BodySchema = z.object({
  content: z.string().min(20, "Need at least 20 chars to organize"),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const SYSTEM = `You are the assistant to a discretionary energy-transition fund PM. Extract structured items from the PM's free-form journal entry.

Output JSON ONLY:
{
  "tradeIdeas": [
    { "symbol": "FSLR", "direction": "long" | "short" | "neutral", "structure": "stock" | "options" | "spread" | "unknown", "rationale": "1 sentence" }
  ],
  "thesisChanges": [
    { "symbol": "FSLR", "change": "1-2 sentences describing what's new vs prior thesis" }
  ],
  "actionItems": [
    { "task": "1 sentence", "ticker": "FSLR or null", "deadline": "YYYY-MM-DD or vague phrase, optional" }
  ],
  "risksFlagged": [
    { "risk": "1 sentence", "ticker": "FSLR or null" }
  ],
  "tagsSuggested": ["3-5 tags from this list: pre-trade, post-trade, thesis-update, macro, meeting-note, earnings-debrief"]
}

Rules:
- Be conservative. If the entry doesn't contain trade ideas, return an empty array — do NOT invent.
- ticker fields should be uppercase. Use null when no specific ticker is named.
- tagsSuggested must be from the fixed list above. Empty array is fine if none apply.
- No prose outside the JSON. No markdown fences.`;

interface OrganizeOutput {
  tradeIdeas: Array<{ symbol: string; direction: string; structure: string; rationale: string }>;
  thesisChanges: Array<{ symbol: string; change: string }>;
  actionItems: Array<{ task: string; ticker: string | null; deadline: string | null }>;
  risksFlagged: Array<{ risk: string; ticker: string | null }>;
  tagsSuggested: string[];
}

const ALLOWED_TAGS = new Set(["pre-trade", "post-trade", "thesis-update", "macro", "meeting-note", "earnings-debrief"]);

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

  const completion = await llmComplete({
    purpose: "thesis",
    system: SYSTEM,
    user: `JOURNAL ENTRY${parsed.data.date ? ` (${parsed.data.date})` : ""}:\n\n${parsed.data.content}\n\nProduce the JSON extraction now.`,
    maxTokens: 1500,
    jsonResponse: true,
  });

  await recordUsage(
    {
      userId: user.user.id,
      model: completion.model,
      endpoint: "journal.organize",
      usage: completion.usage,
    },
    supabase,
  );

  const raw = parseLenientJson<Partial<OrganizeOutput>>(completion.text);
  const out: OrganizeOutput = {
    tradeIdeas: (raw.tradeIdeas ?? [])
      .filter((x) => x && typeof x.symbol === "string")
      .map((x) => ({
        symbol: String(x.symbol).toUpperCase(),
        direction: String(x.direction ?? "neutral"),
        structure: String(x.structure ?? "unknown"),
        rationale: String(x.rationale ?? "").trim(),
      })),
    thesisChanges: (raw.thesisChanges ?? [])
      .filter((x) => x && typeof x.symbol === "string")
      .map((x) => ({
        symbol: String(x.symbol).toUpperCase(),
        change: String(x.change ?? "").trim(),
      })),
    actionItems: (raw.actionItems ?? [])
      .filter((x) => x && typeof x.task === "string")
      .map((x) => ({
        task: String(x.task).trim(),
        ticker: x.ticker ? String(x.ticker).toUpperCase() : null,
        deadline: x.deadline ?? null,
      })),
    risksFlagged: (raw.risksFlagged ?? [])
      .filter((x) => x && typeof x.risk === "string")
      .map((x) => ({
        risk: String(x.risk).trim(),
        ticker: x.ticker ? String(x.ticker).toUpperCase() : null,
      })),
    tagsSuggested: (raw.tagsSuggested ?? [])
      .map((t) => String(t).toLowerCase())
      .filter((t) => ALLOWED_TAGS.has(t)),
  };

  return NextResponse.json({ organized: out });
}
