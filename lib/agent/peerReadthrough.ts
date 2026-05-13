// Generate an AI peer read-through: when a peer ticker reports, what does that
// imply for the affected names in the user's book? Single Claude/DeepSeek call
// per (reporter, affected) pair, structured output saved to peer_readthroughs.

import { llmComplete } from "@/lib/llm";
import { parseLenientJson } from "@/lib/agent/jsonRepair";
import type { NewsHeadline } from "@/lib/providers/news";

export type ReadthroughSentiment = "positive" | "negative" | "neutral";
export type ReadthroughUrgency = "act_before_open" | "monitor" | "noise";

export interface ReadthroughOutput {
  sentiment: ReadthroughSentiment;
  urgency: ReadthroughUrgency;
  summary: string;             // 1-paragraph read-through narrative
  bullets: string[];           // 3-4 specific implications
}

export interface ReadthroughInput {
  reporterSymbol: string;
  reporterName: string | null;
  affectedSymbol: string;
  affectedName: string | null;
  groupName: string;           // peer-group label e.g. "Solar modules"
  existingThesis: string | null;
  headlines: NewsHeadline[];   // reporter's recent news, last 24-48h
  asOfIso: string;
}

const SYSTEM = `You are a discretionary energy-transition fund analyst. When a peer company reports earnings, you write a peer read-through note explaining what the print implies for the OTHER companies in the investor's book.

Be specific. Cite the exact data point or quote from the reporter that drives the read-through. Skip generic statements ("this is bullish for the sector").

Output JSON ONLY — no prose, no fences:
{
  "sentiment": "positive" | "negative" | "neutral",
  "urgency": "act_before_open" | "monitor" | "noise",
  "summary": "1-paragraph read-through narrative tying the reporter's print to the affected ticker's setup. 3-5 sentences.",
  "bullets": ["3-4 specific implications, e.g. 'Module ASPs holding at $0.28/W vs guide of $0.26' — single line each."]
}

Urgency rules:
- "act_before_open": demand-side data point or competitor capacity announcement that should move the affected ticker by >3% intraday
- "monitor": informative but doesn't require immediate action
- "noise": doesn't really matter for the affected ticker — explain why in the summary`;

export async function generatePeerReadthrough(input: ReadthroughInput): Promise<{
  output: ReadthroughOutput;
  model: string;
  usage: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number };
}> {
  const newsBlock =
    input.headlines.length === 0
      ? "(no recent headlines for reporter — base on what you can infer from typical sector dynamics)"
      : input.headlines
          .slice(0, 8)
          .map((n, i) => `[${i + 1}] ${n.title} — ${n.source ?? "?"} (${n.publishedAt.slice(0, 10)})${n.description ? `\n   ${n.description}` : ""}`)
          .join("\n");

  const userPrompt = [
    `PEER GROUP: ${input.groupName}`,
    `REPORTER: ${input.reporterSymbol}${input.reporterName ? ` (${input.reporterName})` : ""}`,
    `AFFECTED TICKER (in user's book): ${input.affectedSymbol}${input.affectedName ? ` (${input.affectedName})` : ""}`,
    `AS OF: ${input.asOfIso}`,
    "",
    `CURRENT THESIS ON ${input.affectedSymbol}:`,
    input.existingThesis?.trim() || "(no thesis on record)",
    "",
    `RECENT REPORTER NEWS:`,
    newsBlock,
    "",
    `Produce the JSON peer read-through now. The summary must reference SPECIFIC data points from the reporter's news — do not be generic.`,
  ].join("\n");

  const completion = await llmComplete({
    purpose: "thesis",
    system: SYSTEM,
    user: userPrompt,
    maxTokens: 1500,
    jsonResponse: true,
  });

  const raw = parseLenientJson<Record<string, unknown>>(completion.text);
  const output: ReadthroughOutput = {
    sentiment: normSentiment(raw.sentiment),
    urgency: normUrgency(raw.urgency),
    summary: String(raw.summary ?? "").trim(),
    bullets: Array.isArray(raw.bullets) ? raw.bullets.map(String).filter(Boolean).slice(0, 6) : [],
  };

  return { output, model: completion.model, usage: completion.usage };
}

function normSentiment(v: unknown): ReadthroughSentiment {
  const s = String(v ?? "").toLowerCase().trim();
  return s === "positive" || s === "negative" || s === "neutral" ? s : "neutral";
}
function normUrgency(v: unknown): ReadthroughUrgency {
  const s = String(v ?? "").toLowerCase().trim();
  if (s === "act_before_open" || s === "monitor" || s === "noise") return s;
  // accept some forgiving aliases
  if (s.includes("urgent") || s.includes("act")) return "act_before_open";
  if (s.includes("monitor") || s.includes("watch")) return "monitor";
  return "noise";
}
