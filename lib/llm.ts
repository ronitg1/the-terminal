// Provider abstraction for LLM calls.
// Default: DeepSeek (V4 Pro for thesis/trade-idea, V4 Flash for chat) — ~14x
// cheaper than Anthropic on this workload.
// Fallback: Anthropic (Sonnet 4.6 / Haiku 4.5) when LLM_PROVIDER=anthropic.
//
// Both paths report usage in a unified shape so lib/billing.ts can compute cost
// against the per-model PRICING table.

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";

export type LlmProvider = "deepseek" | "anthropic";
export type LlmPurpose = "thesis" | "trade-idea" | "chat";

export function getLlmProvider(): LlmProvider {
  return process.env.LLM_PROVIDER === "anthropic" ? "anthropic" : "deepseek";
}

export const MODEL_IDS: Record<LlmProvider, Record<LlmPurpose, string>> = {
  deepseek: {
    thesis: "deepseek-v4-pro",
    "trade-idea": "deepseek-v4-pro",
    chat: "deepseek-v4-flash",
  },
  anthropic: {
    thesis: "claude-sonnet-4-6",
    "trade-idea": "claude-sonnet-4-6",
    chat: "claude-haiku-4-5",
  },
};

export function modelFor(purpose: LlmPurpose): string {
  return MODEL_IDS[getLlmProvider()][purpose];
}

// ---------------------------------------------------------------------------
// Singletons
// ---------------------------------------------------------------------------

let _deepseek: OpenAI | undefined;
export function getDeepseek(): OpenAI {
  if (_deepseek) return _deepseek;
  const apiKey = process.env.DEEPSEEK_API_KEY?.trim();
  if (!apiKey) throw new Error("DEEPSEEK_API_KEY is not set in .env.local");
  _deepseek = new OpenAI({ apiKey, baseURL: "https://api.deepseek.com/v1" });
  return _deepseek;
}

let _anthropic: Anthropic | undefined;
export function getAnthropic(): Anthropic {
  if (_anthropic) return _anthropic;
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set in .env.local");
  _anthropic = new Anthropic({ apiKey });
  return _anthropic;
}

// ---------------------------------------------------------------------------
// Unified usage reporting (consumed by lib/billing.ts)
// ---------------------------------------------------------------------------

export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

function deepseekUsage(u: unknown): LlmUsage {
  const o = (u ?? {}) as {
    prompt_tokens?: number;
    completion_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
  // DeepSeek splits prompt_tokens into cache_hit + cache_miss.
  const hit = o.prompt_cache_hit_tokens ?? 0;
  // miss tokens = prompt_tokens - hit (some versions also expose prompt_cache_miss_tokens)
  const miss = o.prompt_cache_miss_tokens ?? Math.max(0, (o.prompt_tokens ?? 0) - hit);
  return {
    input_tokens: miss,
    output_tokens: o.completion_tokens ?? 0,
    cache_read_input_tokens: hit,
    cache_creation_input_tokens: 0,
  };
}

function anthropicUsage(u: Anthropic.Usage): LlmUsage {
  return {
    input_tokens: u.input_tokens ?? 0,
    output_tokens: u.output_tokens ?? 0,
    cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Non-streaming JSON completion (thesis / trade-idea)
// ---------------------------------------------------------------------------

export interface LlmCompleteOpts {
  purpose: LlmPurpose;
  system: string;
  user: string;
  maxTokens: number;
  /** If true, the model is asked to return JSON. */
  jsonResponse?: boolean;
}

export interface LlmCompleteResult {
  text: string;
  model: string;
  usage: LlmUsage;
}

export async function llmComplete(opts: LlmCompleteOpts): Promise<LlmCompleteResult> {
  const provider = getLlmProvider();
  const model = MODEL_IDS[provider][opts.purpose];

  if (provider === "deepseek") {
    const client = getDeepseek();
    // DeepSeek V4 enables thinking mode by default. For structured JSON output
    // tasks (thesis, trade-idea) the thinking tokens count against max_tokens,
    // so the model burns through the budget before any JSON is produced and
    // the output is truncated mid-string. Disable thinking on these paths;
    // V4 Pro is still very capable without it.
    const response = await client.chat.completions.create({
      model,
      max_tokens: opts.maxTokens,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      ...(opts.jsonResponse ? { response_format: { type: "json_object" } } : {}),
      thinking: { type: "disabled" },
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming & { thinking: { type: "disabled" } });
    const text = response.choices[0]?.message?.content ?? "";
    return { text, model, usage: deepseekUsage(response.usage) };
  }

  // Anthropic
  const client = getAnthropic();
  const response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens,
    thinking: { type: "adaptive" },
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
  });
  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  return { text, model, usage: anthropicUsage(response.usage) };
}
