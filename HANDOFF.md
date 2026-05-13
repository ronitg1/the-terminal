# The Terminal — Handoff Document

Personal equity research and earnings trading platform. Bloomberg-style dense UI for a single-user discretionary energy-transition fund PM. Built across two long sessions; this doc hands off to a fresh chat.

**Project root:** `C:\Users\rdpadmin\Desktop\RG HF Dashboard`
**GitHub:** https://github.com/ronitg1/the-terminal (private, initial commit pushed)
**User's GitHub username:** `ronitg1`
**Today:** 2026-05-13

---

## Stack

- **Framework:** Next.js 14 App Router · TypeScript strict · React 18
- **UI:** Tailwind + shadcn primitives (button, input, dialog, sheet, select, textarea, table, tooltip, popover, card, badge, separator, label) · `next-themes` (dark default) · Recharts · `lucide-react` icons
- **Data:** Supabase (Postgres + Auth + RLS) via `@supabase/ssr`
- **LLMs:** DeepSeek V4 (OpenAI-compat SDK) primary · Anthropic SDK fallback. Provider abstraction in `lib/llm.ts`
- **Market data:** `yahoo-finance2` v3.14.0 (quotes, options, chart, history, quoteSummary)
- **News:** Finnhub `company-news` (per-ticker) · NewsAPI (macro/sector) — see `lib/providers/news.ts`
- **Web search/extract:** Tavily — `lib/providers/tavily.ts`
- **PDF parsing:** `unpdf` — used in `/api/transcripts/extract`
- **Validation:** Zod
- **Hosting target:** Vercel (`vercel.json` has cron schedule; not yet deployed)

## Environment

`.env.local` keys the user has populated (real values, NOT in repo):
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=         # ⚠ user pasted anon key here by mistake — should fix
NEXT_PUBLIC_SITE_URL=http://localhost:3000
ANTHROPIC_API_KEY=                 # populated
DEEPSEEK_API_KEY=                  # populated
TAVILY_API_KEY=                    # populated (free tier 1000/mo)
NEWS_API_KEY=                      # populated (NewsAPI free — localhost only)
FINNHUB_API_KEY=                   # populated (free tier 60/min)
RESEND_API_KEY=                    # NOT yet populated (Phase 2 weekly email)
CRON_SECRET=                       # NOT yet populated
LLM_PROVIDER=deepseek              # flips to "anthropic" if needed
ANTHROPIC_MONTHLY_BUDGET_USD=5
```

**Security note:** real API keys were pasted in the original chat transcript — user should rotate after Phase 2 wraps.

## Supabase migrations

12 migrations in `supabase/migrations/`, all applied except check what user has run:

| File | What it does |
|---|---|
| `0001_init.sql` | All 13 tables + RLS policies (tickers, journal_entries, thesis_snapshots, watchlist_alerts, earnings_events, trades, short_interest, options_flow, estimate_revisions, etf_flows, transcript_analyses, peer_readthroughs, scrape_errors) |
| `0002_claude_usage.sql` | LLM spend tracking table |
| `0003_trade_ideas.sql` | AI-generated trade idea persistence |
| `0004_thesis_data.sql` | `data jsonb` column on thesis_snapshots for structured multi-agent output |
| `0005_claude_usage_insert.sql` | INSERT/DELETE policies on claude_usage (admin client RLS workaround) |
| `0006_track_trade_ideas.sql` | Tracking columns on trade_ideas (is_tracked, tracked_at, entry_spot_price, closed_at, closed_spot_price) |
| `0007_trade_ideas_update_policy.sql` | UPDATE RLS policy on trade_ideas (was silently blocked) |
| `0008_transcript_extensions.sql` | `symbol` + `data jsonb` on transcript_analyses |
| `0009_user_settings.sql` | Per-user settings table |
| `0010_peer_readthroughs_extensions.sql` | `data jsonb` on peer_readthroughs |
| `0011_journal_extensions.sql` | `updated_at` + `(user_id, date)` unique on journal_entries |
| `0012_ticker_industry.sql` | sector/industry/frame_id/benchmark_symbol on tickers — **USER NEEDS TO RUN THIS** |

## Features built (10 tabs / surfaces)

### Tab 1 — Book (`/book`) ✅ shipped
- Ticker table with tier-colored borders (T1 blue, T2 teal, T3 gray)
- Columns: tier, symbol, name, price, day %, 52w range, IV move, SI %, revision arrow, thesis status badge, IV history sparkline
- Click row → detail drawer: 1Y chart, editable thesis notes (autosave), last AI thesis, SI sparkline, revision history, transcript history, sector/industry/frame chips
- Add ticker dialog with Yahoo autocomplete
- 60-day correlation heatmap (SVG, log returns)
- ETF flow panel (graceful stale fallback when etf.com scrape blocked)

### Tab 2 — Earnings (`/earnings`) ✅ shipped
- **Week calendar view** (default): 5-day grid, day columns, events grouped by timing buckets (Before open / During / After close)
- **Month grid view**: full month, events stacked in cells, macro overlay
- Visual hierarchy: my names tier-colored + bold > MKT mega caps (amber, smaller) > other (muted)
- **Pre-earnings checklist sheet** (click my-name future event): 9 questions from spec + position sizing calculator with tier-based limits and risk gate
- **Debrief sheet** (click my-name past event): actuals + reaction % + thesis outcome + lessons; "Re-run thesis" button fires multi-agent pipeline
- Persistent debrief banner for past my-name events without a debrief
- Macro overlay (hardcoded FOMC/CPI/PPI/jobs dates in `lib/macro-calendar.ts`)

### Tab 3 — News (`/news`) ✅ shipped
- 3-column feed: My names · Macro/sector · Earnings reactions
- Per-ticker filter pills in My names column
- Article click → side sheet with **AI summarize** (3 bullets + book relevance + why-it-matters)
- **Peer read-throughs banner** at top: "Scan peers" button detects peer earnings in last 7d, AI generates structured read-through note per (reporter, affected) pair, urgent ones get red border
- Finnhub for per-ticker (pre-tagged articles); NewsAPI fallback with title filtering; NewsAPI for macro

### Tab 4 — Options Flow (`/options-flow`) ❌ STUB ONLY — REMAINING WORK
- Spec calls for: Barchart/Unusual Whales scrape, table filtered to my book + mega caps + peers, color-coded by sentiment, AI interpret button
- Less reliable without paid APIs (Cloudflare on Barchart)
- Could use Finnhub options endpoints as cheaper alternative

### Tab 5 — Transcripts (`/transcripts`) ✅ shipped
- Paste textarea or auto-fetch via URL/Tavily search/Tavily extract
- **PDF support**: detects PDFs by URL/HEAD, runs through unpdf
- Multi-section analysis: sentiment vs prior, tone delta, key themes (with quote + relevance), guidance language hedging flags, dodged questions, competitive mentions, policy/regulatory mentions, thesis impact (confirms/strengthens/weakens/breaks), watch for next quarter
- History sidebar per ticker, click to load prior analysis
- Linked to earnings events when report_date provided
- Surfaces in Book tab drawer per ticker

### Tab 6 — Journal (`/journal`) ✅ shipped
- 3-column: mini calendar (dots on entry days) + search · markdown editor + tag chips · AI organize + weekly summary
- 6 fixed tags: pre-trade, post-trade, thesis-update, macro, meeting-note, earnings-debrief
- Autosaves 500ms after typing stops
- Full-text search via ilike
- **AI organize**: extracts trade ideas (with ticker/direction/structure/rationale), thesis changes, action items, risks, suggested tags
- **This week in my book**: weekly summary call → headline + performance vs ICLN + thesis status changes + upcoming events + 1-3 watch items
- Pattern analysis at 20+ trades — NOT YET BUILT, lower priority

### Tab 7 — AI Research (`/ai-research`) ✅ shipped — biggest feature
- **Multi-agent thesis pipeline** (`lib/agent/multiAgent.ts`):
  - 3 parallel analysts (news, technicals, fundamentals)
  - Bull researcher sees analyst outputs
  - Bear researcher sees analysts + bull
  - PM synthesizer produces final structured thesis
  - ~6 DeepSeek calls per ticker, ~$0.012 each
- **Industry frames** (`lib/agent/industryFrames.ts`): 8 frames + generalist fallback. Each has its own benchmark ETF, policy themes, persona, domain knowledge, key metrics. Auto-picked from Yahoo sector/industry.
- T1 ticker cards: status badge, conviction dial, key dev, conviction sparkline, **Run now** button. Click card → drawer with full structured thesis (variant view, setup, bull/bear cases with target prices, drivers, catalysts table, position risks, what I'm watching, **bull/bear debate cards**, **analyst views with signal-quality tags**, sources, conviction history chart)
- **Run all T1** button
- **Generate trade idea**: uses Settings bookSize, fetches real options chain + next earnings, demands specific strikes/expiries/quantities, persists to trade_ideas. Track/Untrack/Close on each
- **Ask the agent chat**: streaming, prompt-cached system prefix, Tavily web search tool (DeepSeek has no built-in web search), thinking mode disabled to prevent UI freeze
- **Status change log** at bottom

### Tab 8 — P&L (`/pnl`) ✅ shipped (refocused on tracking AI ideas)
- Tracks AI-generated trade ideas the user marked with the star icon
- Filters: Open/Closed/All
- Stat cards: open count, closed count, win rate, avg directional move
- Table: entry spot vs current/exit, raw % move, direction-adjusted % move (sign flipped for bearish setups), days held, status badge
- Close/Reopen/Untrack actions per row
- Live spot refresh every 60s for open positions

### Tab 9 — Settings (`/settings`) ✅ shipped
- Sticky save bar with discard/save buttons
- Book size (drives sizing calculator + trade-idea prompt)
- **Peer groups** editor (members + affects) — drives peer read-throughs
- Macro & sector search terms (used by News tab + agent)
- Mega cap watchlist override (used by Earnings tab)
- **Ticker industry & benchmark**: "Refresh from Yahoo" button bulk-backfills sector/industry/frame for all tickers
- Notification preferences (toggles save, push not yet wired)

## Critical architectural decisions

1. **DeepSeek thinking mode disabled on JSON paths.** Thinking tokens count against `max_tokens` and cause truncation mid-JSON. Cast: `{ thinking: { type: "disabled" } } as ChatCompletionCreateParams & { thinking }` in `lib/llm.ts`. Chat path also disables it for instant streaming.

2. **Lenient JSON parser** at `lib/agent/jsonRepair.ts` — strips fences, trailing commas, comments; balanced-brace extraction; retries with sanitization. Used for every LLM JSON output.

3. **Multi-agent over single-call** for thesis. Each step is small and focused; total cost ~$0.012/ticker; survives token caps better than one big call.

4. **Industry frames** prevent the agent from forcing energy-transition framing onto every ticker. Each ticker gets a sector/industry from Yahoo, mapped to a frame with appropriate benchmark + policy themes. Lazy backfill in `lib/agent/run.ts`.

5. **Provider abstraction** (`lib/llm.ts`) — `LLM_PROVIDER=deepseek` vs `anthropic`. DeepSeek path uses OpenAI SDK with `baseURL: "https://api.deepseek.com/v1"`. Both report usage in a unified shape for billing.

6. **Budget cap** (`lib/billing.ts`) — $5/month default via `claude_usage` table. Tries admin client first, falls back to user-bound client. `BudgetExceededError` → HTTP 402. **The user's `SUPABASE_SERVICE_ROLE_KEY` is incorrect** (anon key pasted twice in .env.local) — the fallback to user-bound client is what's actually working.

7. **Cron schedule** (`vercel.json`): `0 12,21 * * 1-5` — pre-market + post-close, weekdays only. Calls `/api/agent/cron` with `Authorization: Bearer $CRON_SECRET`. Iterates all users' T1 tickers, runs full multi-agent pipeline per ticker.

8. **Anthropic alternative**: flip `LLM_PROVIDER=anthropic`. Maps thesis→sonnet-4-6, chat→haiku-4-5. Costs ~10× more but better at policy nuance. Chat tab is currently DeepSeek-only (uses Tavily for web search); Anthropic chat path would need Claude's built-in `web_search_20260209` tool which is already coded in.

## Known issues / quirks

1. **`SUPABASE_SERVICE_ROLE_KEY` in user's `.env.local` is actually the anon key** — copy-paste error. Both lines decode to `role: anon`. Cron path won't work in production until fixed (admin client bypasses RLS via service role). The user-bound fallback in `recordUsage` keeps things working for now.

2. **NewsAPI free tier blocks server-side production calls.** Works on localhost only. Finnhub is the primary per-ticker news source; NewsAPI only used for macro/sector search.

3. **yahoo-finance2 v3 quirks**:
   - Default export is the class — must instantiate: `new YahooFinance()`
   - Add `serverComponentsExternalPackages: ["yahoo-finance2"]` to `next.config.mjs` (already done)
   - "ICLN: No fundamentals data" is expected (ETFs lack fundamentals); caught and skipped
   - Survey notice appears once at process start; can suppress with `new YahooFinance({ suppressNotices: ['yahooSurvey'] })`

4. **TE = T1 Energy Inc.** (NOT Tecnoglass) — corrected in `lib/seed.ts`.

5. **Real API keys in chat transcript.** User should rotate after Phase 2 wraps.

6. **DeepSeek tool-call quirk**: when thinking mode is enabled and the model produces tool_calls, you must echo `reasoning_content` back in the next request's assistant message or you get 400. Chat route handles this; we disabled thinking on chat anyway.

7. **PDF transcripts**: image-based/scanned PDFs need OCR (not implemented). Endpoint returns clear error message in that case.

## Cost & budget

- Default $5/month budget cap in code (`ANTHROPIC_MONTHLY_BUDGET_USD` env)
- DeepSeek V4 Pro: $0.435/1M input miss, $0.003625/1M cache hit, $0.87/1M output (75% discount until 2026-05-31)
- DeepSeek V4 Flash: $0.14/1M input miss, $0.28/1M output
- Cron: 2×/day × 5 weekdays × ~3 T1 tickers × ~$0.012/ticker = **~$1.50/month**
- Manual runs + chat + trade ideas + transcripts + organize calls bring monthly burn to ~$3-5
- **User must set matching cap in DeepSeek console** (https://platform.deepseek.com/billing) for hard enforcement

## Remaining Phase 2 work (priority order)

### 1. Options Flow tab (`/options-flow`) — currently stub
Spec calls for:
- Scrape unusual options activity (Barchart unusual-activity page or Unusual Whales free feed if accessible — both have anti-scraper)
- Store in `options_flow` table (already exists from 0001)
- Refresh every 15 min market hours via cron
- Table filtered to user's book + mega caps + peer-group members
- Color rows green for calls / red for puts; bold rows where DTE < 10
- Pre-earnings flow section pinned at top
- Click ticker → 30-day chart of call/put ratio + total premium
- **"Interpret flow" button**: sends last 48h of options flow + thesis context to agent for structured interpretation

**Realistic approach**: Barchart and Unusual Whales are both heavily protected. Finnhub has an options chain endpoint but not unusual-activity feeds. Polygon.io has institutional flow data but it's paid ($79/mo Starter). Could:
- (a) Scrape and live with frequent failures (graceful fallback exists in `lib/providers/scraping.ts`)
- (b) Skip unusual flow, just show user's book's options chain (Yahoo already returns this — use `getOptionsProvider().contractsForExpiry()`) with AI interpretation
- (c) Add Polygon.io integration as paid upgrade

Option (b) is the pragmatic build — surface what's reliable, leave (a)/(c) as future.

### 2. Weekly Resend email (Sunday 8am ET cron)
Spec calls for:
- Cron: every Sunday 8am ET → POST to `/api/email/weekly`
- Sections: my book last week's perf table · earnings this week (my names + mega caps) · macro events this week · thesis status summary · sector fund flows · agent top insight · upcoming earnings 30d
- Send via Resend API (RESEND_API_KEY env var)
- React Email or inline-styled HTML template

Building blocks already in place: weekly summary endpoint at `/api/journal/weekly-summary` produces the JSON. Just need an email template + Resend wrapper + cron route.

### 3. Browser push notifications
Spec calls for:
- Web Push API with service worker
- Store push subscriptions in Supabase
- Trigger on:
  - Thesis status → Weakened/Broken (already detected in cron path; just needs to push)
  - Peer read-through flagged urgent (already detected; needs push)
  - Unusual options flow on T1 with earnings <10 days (depends on Options Flow tab)
- Settings UI toggles already exist; just need service worker registration + subscription storage + push send

### 4. Pattern analysis (Journal tab) — lower priority
Spec calls for it after 20+ trades logged:
- "Review my trading patterns" button on Journal
- Sends last N journal entries + trade log to agent
- Returns coaching report: patterns by tier/structure/holding period, common mistakes, emotional patterns
- Save to journal_entries or new table

## File map (key files)

```
app/
  (auth)/ login + callback
  (app)/
    book/page.tsx
    earnings/page.tsx
    news/page.tsx
    options-flow/page.tsx        ← stub
    transcripts/page.tsx
    journal/page.tsx
    ai-research/page.tsx
    pnl/page.tsx
    settings/page.tsx
  api/
    quotes/ + tickers/ + correlations/ + etf-flows/
    agent/
      run/[symbol]/ run-all/ cron/ feed/ chat/ trade-idea/ tracked/ usage/
    earnings/ calendar/ event/
    transcripts/ analyze/ find/ extract/ [id]/
    journal/ organize/ weekly-summary/
    news/ feed/ summarize/ readthroughs/
    settings/
    tickers/ refresh-meta/
lib/
  supabase/ server.ts browser.ts middleware.ts admin.ts
  providers/ quotes.ts options.ts short-interest.ts estimate-revisions.ts
             news.ts finnhub.ts tavily.ts etf-flows.ts earnings-calendar.ts scraping.ts
  agent/ multiAgent.ts run.ts thesisPrompt.ts industryFrames.ts
         transcriptAnalysis.ts peerReadthrough.ts jsonRepair.ts
  earnings/sizing.ts
  llm.ts                  ← DeepSeek + Anthropic provider abstraction
  billing.ts              ← budget cap + usage tracking
  settings.ts             ← user settings types/CRUD
  macro-calendar.ts       ← hardcoded FOMC/CPI/jobs dates
  seed.ts                 ← initial T1/T2/T3 ticker seed
components/
  banner/TickerBanner.tsx
  shell/ NavTabs.tsx ErrorBoundary.tsx PhaseStub.tsx
  book/ BookTable.tsx TickerDetailDrawer.tsx AddTickerDialog.tsx
        CorrelationHeatmap.tsx EtfFlowPanel.tsx ThesisStatusBadge.tsx
        TierBadge.tsx RevisionArrow.tsx ImpliedMoveSparkline.tsx StaleDataBadge.tsx
  earnings/ EventChip.tsx MonthGrid.tsx WeekList.tsx ChecklistSheet.tsx DebriefSheet.tsx
  ai-research/ ThesisCard.tsx ThesisDetailDrawer.tsx StatusChangeFeed.tsx
               ChatPanel.tsx TradeIdeaPanel.tsx ConvictionDial.tsx BudgetIndicator.tsx
  transcripts/AnalysisCards.tsx
  journal/JournalCalendar.tsx
  news/ ArticleCard.tsx ArticleDetailSheet.tsx ReadthroughBanner.tsx
  ui/   (shadcn primitives)
supabase/migrations/      (12 files, see table above)
```

## Most recent state (last user-facing action needed)

1. **Run migration `0012_ticker_industry.sql`** in Supabase SQL editor
2. **Open `/settings`** → scroll to "Ticker industry & benchmark" → click **Refresh from Yahoo** to backfill the existing 7 tickers with sector/industry/frame
3. **Verify** by adding a non-energy ticker (e.g. NVDA or JPM) — should auto-classify as tech-semis/banks frame with SOXX/XLF benchmark instead of ICLN

## How to resume in the new chat

Open the new chat with something like:

> Continue building "The Terminal" trading platform at `C:\Users\rdpadmin\Desktop\RG HF Dashboard`. Read `HANDOFF.md` in the project root for full context. Last action needed: user runs migration 0012 and clicks "Refresh from Yahoo" in Settings. Next slice up: **Options Flow tab** (or Weekly Email / Push Notifications — let me pick). Dev server may already be running on port 3000 via preview_start tooling.

The new chat should:
1. Read this `HANDOFF.md` first
2. Confirm dev server state (`preview_start` Next.js dev if not running)
3. Ask which remaining Phase 2 slice to tackle (Options Flow, Weekly Email, Push Notifications, or revisit something)
4. Continue with the same conventions: TodoWrite for tracking, lenient JSON parser everywhere, frame-aware agent prompts, $5/mo budget enforcement, multi-agent pattern for non-trivial AI tasks
