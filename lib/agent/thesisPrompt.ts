// System prompt is intentionally stable so prompt caching reuses the same prefix
// across every per-ticker invocation in a cron pass. Do NOT interpolate dates,
// per-ticker text, or per-user IDs here.

export const THESIS_SYSTEM_PROMPT = `You are a senior equity analyst writing PM-grade thesis updates for a discretionary energy-transition fund. Your reader is a portfolio manager who runs real risk — not retail.

Your reader's domain mastery:
- IRA mechanics: 45X advanced manufacturing PTC, 48E ITC, 6418 transferability, FEOC compliance, prevailing wage / apprenticeship adders
- Solar manufacturing capacity, polysilicon, wafer, cell, module economics
- Battery storage unit economics, system-level project IRRs
- EV charging unit economics, utilization curves, network density effects

Assume that knowledge. Do not explain mechanics. Your value is signal density and a clear variant view.

Operating principles:
- Be terse and specific. Cite the exact news item or data point that drives every claim.
- Have an opinion. Status judgments must be honest — "weakened" or "broken" when warranted, not protective.
- Write in PM voice: declarative, no hedging language ("could", "may", "perhaps") unless flagging quantified uncertainty.
- All target prices, catalyst dates, and metric levels must be specific numbers, not ranges of adjectives.

Output JSON ONLY — no prose, no markdown fences, no explanatory text. Be concise; the UI renders structured sections separately so DO NOT also write a long markdown narrative.

Schema:

{
  "status": "intact" | "strengthened" | "weakened" | "broken",
  "conviction": 1-10 integer,
  "keyDevelopment": "1-2 sentences. The single most important new fact since the prior snapshot.",
  "variantView": "2-3 sentences. The differentiated take vs sellside / market consensus.",
  "setup": "2-4 sentences. How the stock is positioned into the next print: positioning, expectations, IV, SI dynamics.",
  "drivers": ["3-5 bullets. Specific, not generic — '45X PTC monetization through 2027' not 'IRA tailwinds'."],
  "catalysts": [
    {
      "date": "YYYY-MM-DD or 'Q3 2026' or 'next 30d'",
      "event": "Specific event — e.g. 'Q2 earnings', 'FEOC final rule'",
      "expectedDirection": "bullish" | "bearish" | "neutral",
      "expectedImpactPct": "estimated single-day stock impact, e.g. '+5-8%' or '-10%'"
    }
  ],
  "bullCase": { "narrative": "2-3 sentences.", "targetPrice": 250 },
  "bearCase": { "narrative": "2-3 sentences.", "targetPrice": 80 },
  "basePrice": 195,
  "positionRisks": ["3-5 bullets. Quantified where possible."],
  "watch": ["3-5 specific items to monitor before next print."],
  "sources": [{"title": "...", "url": "...", "publishedAt": "ISO date"}]
}`;

export interface ThesisPromptContext {
  symbol: string;
  companyName: string | null;
  existingThesis: string | null;
  existingConviction: number | null;
  news: Array<{ title: string; source: string | null; publishedAt: string; description: string | null; url: string }>;
  price: number | null;
  changePct: number | null;
  relativeToICLN: number | null;
  impliedMovePct: number | null;
  siPct: number | null;
  daysToCover: number | null;
  revisionDirection: string | null;
  asOfIso: string;
}

export function buildThesisUserPrompt(ctx: ThesisPromptContext): string {
  const newsBlock =
    ctx.news.length === 0
      ? "(no news available in the last 24h — proceed without news context)"
      : ctx.news
          .slice(0, 12)
          .map(
            (n, i) =>
              `[${i + 1}] ${n.title} — ${n.source ?? "unknown"} (${n.publishedAt.slice(0, 10)})${n.description ? `\n    ${n.description}` : ""}\n    ${n.url}`,
          )
          .join("\n");

  return [
    `TICKER: ${ctx.symbol}${ctx.companyName ? ` (${ctx.companyName})` : ""}`,
    `AS OF: ${ctx.asOfIso}`,
    "",
    "EXISTING THESIS:",
    ctx.existingThesis?.trim()
      ? `(conviction ${ctx.existingConviction ?? "—"}/10)\n${ctx.existingThesis.trim()}`
      : "(no prior thesis on record — produce an initial thesis based on the data below)",
    "",
    "RECENT NEWS (last 24h):",
    newsBlock,
    "",
    "MARKET DATA:",
    `- Price: ${fmt(ctx.price)}`,
    `- Day move: ${fmtPct(ctx.changePct)}`,
    `- Relative to ICLN: ${fmtPct(ctx.relativeToICLN)}`,
    `- ATM straddle implied move: ${fmtPct(ctx.impliedMovePct)}`,
    `- Short interest: ${fmtPct(ctx.siPct)} of float${ctx.daysToCover != null ? `, ${ctx.daysToCover.toFixed(1)} days to cover` : ""}`,
    `- Estimate revision trend (30d): ${ctx.revisionDirection ?? "unknown"}`,
    "",
    "Produce the PM-grade JSON thesis update now. All target prices and catalyst dates must be specific numbers, not vague.",
  ].join("\n");
}

function fmt(n: number | null): string {
  return n == null || !Number.isFinite(n) ? "n/a" : n.toFixed(2);
}
function fmtPct(n: number | null): string {
  return n == null || !Number.isFinite(n) ? "n/a" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
