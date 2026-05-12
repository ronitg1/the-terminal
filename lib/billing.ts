// Monthly Anthropic spend cap. The Anthropic-console spend limit is the ONLY
// true hard cap (set it in console.anthropic.com → Settings → Limits). This
// module enforces a softer application-level cap before each API call so that
// repeated small calls can't accidentally blow past the user's budget.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminSupabase } from "@/lib/supabase/admin";

export const DEFAULT_MONTHLY_BUDGET_USD = 5;

export function getMonthlyBudgetUsd(): number {
  const raw = process.env.ANTHROPIC_MONTHLY_BUDGET_USD;
  const n = raw ? Number.parseFloat(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MONTHLY_BUDGET_USD;
}

// Prices in USD per 1M tokens. Update when migrating models.
// `cacheRead` and `cacheWrite` default to Anthropic-style multipliers of `input`
// when omitted — DeepSeek publishes them separately so we set them explicitly.
interface ModelPricing {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}
const ANTHROPIC_CACHE_READ_MULT = 0.1;
const ANTHROPIC_CACHE_WRITE_MULT = 1.25;
const PRICING: Record<string, ModelPricing> = {
  "claude-sonnet-4-6": { input: 3.0, output: 15.0 },
  "claude-sonnet-4-5": { input: 3.0, output: 15.0 },
  "claude-opus-4-7": { input: 5.0, output: 25.0 },
  "claude-opus-4-6": { input: 5.0, output: 25.0 },
  "claude-haiku-4-5": { input: 1.0, output: 5.0 },
  // DeepSeek V4 (75% discount on Pro extended through 2026-05-31).
  "deepseek-v4-pro": { input: 0.435, output: 0.87, cacheRead: 0.003625 },
  "deepseek-v4-flash": { input: 0.14, output: 0.28, cacheRead: 0.0028 },
};

export interface UsageTokens {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export function computeCostUsd(model: string, usage: UsageTokens): number {
  const p = PRICING[model];
  if (!p) {
    // Unknown model — assume sonnet pricing to fail safe (overestimates DeepSeek).
    return computeCostUsd("claude-sonnet-4-6", usage);
  }
  const cacheReadRate = p.cacheRead ?? p.input * ANTHROPIC_CACHE_READ_MULT;
  const cacheWriteRate = p.cacheWrite ?? p.input * ANTHROPIC_CACHE_WRITE_MULT;
  const cacheRead = usage.cache_read_input_tokens ?? 0;
  const cacheWrite = usage.cache_creation_input_tokens ?? 0;
  const inputUncached = usage.input_tokens ?? 0;
  const output = usage.output_tokens ?? 0;
  const cost =
    (inputUncached / 1_000_000) * p.input +
    (cacheRead / 1_000_000) * cacheReadRate +
    (cacheWrite / 1_000_000) * cacheWriteRate +
    (output / 1_000_000) * p.output;
  return Math.max(0, cost);
}

export interface MonthSpend {
  spendUsd: number;
  budgetUsd: number;
  remainingUsd: number;
  pctUsed: number;
  windowStart: string;
}

function monthStartIso(): string {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
}

// Sum cost for THIS user this calendar month (UTC). When user_id is null we sum
// across all users (used by cron with the admin client).
export async function getMonthToDateSpend(
  supabase: SupabaseClient,
  userId: string | null,
): Promise<MonthSpend> {
  const windowStart = monthStartIso();
  let q = supabase
    .from("claude_usage")
    .select("cost_usd")
    .gte("occurred_at", windowStart);
  if (userId) q = q.eq("user_id", userId);

  const { data, error } = await q;
  if (error) {
    console.error("getMonthToDateSpend error", error);
    return blank(windowStart);
  }
  const spendUsd = (data ?? []).reduce(
    (sum, row) => sum + Number((row as { cost_usd: number | string }).cost_usd ?? 0),
    0,
  );
  const budgetUsd = getMonthlyBudgetUsd();
  return {
    spendUsd,
    budgetUsd,
    remainingUsd: Math.max(0, budgetUsd - spendUsd),
    pctUsed: budgetUsd > 0 ? spendUsd / budgetUsd : 0,
    windowStart,
  };
}

function blank(windowStart: string): MonthSpend {
  const budgetUsd = getMonthlyBudgetUsd();
  return { spendUsd: 0, budgetUsd, remainingUsd: budgetUsd, pctUsed: 0, windowStart };
}

export class BudgetExceededError extends Error {
  constructor(public month: MonthSpend) {
    super(
      `Monthly Anthropic budget exceeded: $${month.spendUsd.toFixed(2)} of $${month.budgetUsd.toFixed(2)}. Raise ANTHROPIC_MONTHLY_BUDGET_USD or wait until next month.`,
    );
    this.name = "BudgetExceededError";
  }
}

// Call before every API request. Throws BudgetExceededError if over budget.
// `userId` is null for the cron path; pass the calling user's id otherwise.
export async function ensureBudget(
  supabase: SupabaseClient,
  userId: string | null,
): Promise<MonthSpend> {
  const month = await getMonthToDateSpend(supabase, userId);
  if (month.spendUsd >= month.budgetUsd) {
    throw new BudgetExceededError(month);
  }
  return month;
}

// Record a completed API call. Tries the service-role client first (bypasses
// RLS, works for cron). If that fails (e.g. SUPABASE_SERVICE_ROLE_KEY missing
// or misconfigured), falls back to the optional user-bound supabase client
// which can insert thanks to the per-user INSERT policy added in migration 5.
export async function recordUsage(
  args: {
    userId: string | null;
    model: string;
    endpoint: string;
    usage: UsageTokens;
  },
  userSupabase?: SupabaseClient,
): Promise<{ costUsd: number } | null> {
  const costUsd = computeCostUsd(args.model, args.usage);
  const row = {
    user_id: args.userId,
    model: args.model,
    endpoint: args.endpoint,
    input_tokens: args.usage.input_tokens ?? 0,
    output_tokens: args.usage.output_tokens ?? 0,
    cache_read_tokens: args.usage.cache_read_input_tokens ?? 0,
    cache_creation_tokens: args.usage.cache_creation_input_tokens ?? 0,
    cost_usd: costUsd,
  };

  // 1. Try service-role client first.
  try {
    const admin = createAdminSupabase();
    const { error } = await admin.from("claude_usage").insert(row as never);
    if (!error) return { costUsd };
    console.warn("recordUsage admin insert failed, trying user client", error.message);
  } catch (err) {
    console.warn("recordUsage admin client unavailable, trying user client", err);
  }

  // 2. Fall back to the user-bound client.
  if (userSupabase && args.userId) {
    const { error } = await userSupabase.from("claude_usage").insert(row as never);
    if (error) {
      console.error("recordUsage user-client insert failed", error);
      return null;
    }
    return { costUsd };
  }

  console.error("recordUsage: no usable supabase client");
  return null;
}
