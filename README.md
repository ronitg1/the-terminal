# The Terminal

> **A self-hosted Bloomberg-style research and earnings-trading dashboard for one investor — with an AI agent that reads your book overnight, flags what changed, and writes you concrete trade plans.**
>
> 💡 **Best run locally** via `npm run dev` — see the [Local vs cloud](#local-vs-cloud) comparison below for why.

Bloomberg is $24,000/year, locked to a single physical terminal, and assumes you have a team of analysts. This is **your** version of the parts that actually matter for a discretionary book, running on your own infrastructure for ~$5/month in API costs.

You bring a list of 5–20 names you actually trade. The system handles the rest: continuously updated thesis, earnings prep, transcript breakdowns, options flow, sector rotation context, news triage. When something changes — your thesis tips toward "broken," a peer reports earnings that read across to your name, unusual options flow shows up 8 days before a print — you get a push notification with the relevant context already loaded.

## The problem

You're a discretionary investor running 5–20 names. You can't read every transcript, every 8-K, every options chain every morning. You can't keep track of when CHPT's thesis goes from "intact" to "weakened" while you're focused on the FSLR print this week. You can't write an executable trade plan from scratch in 10 minutes between meetings.

What you *can* do is delegate that to a system that wakes up at 4 AM, reads the overnight tape, re-runs a multi-step research pipeline against each of your T1 names, and surfaces only what changed and why.

That's what this is.

---

## What's in the box

Nine surfaces, each answering a question a PM actually asks:

### 📈 Book — *what is true about my positions right now?*

Dense, tier-colored ticker table: price · day % · 52w range · implied move into next earnings · short interest · estimate revision direction · current AI thesis status with conviction score · IV history sparkline. Below it, a 60-day correlation heatmap shows you when your "diversified" book starts trading as one position. Below *that*, personalized sector ETF flows — AUM-delta minus price-return decomposition, so you see real money moving, not just price action.

### 📅 Earnings — *when do my names print, and am I ready?*

Week + month calendar. Your names tier-colored and bold; mega-caps amber-tagged as `MKT`; macro overlays (FOMC, CPI, jobs prints) ghosted gray so you see the days where everything lines up. Click a future event and a **pre-earnings checklist sheet** opens — nine structured questions plus a position sizing calculator with hard tier-based risk limits. Click a past event and a **debrief sheet** opens with actuals, the day's reaction %, and a "what did I learn" prompt. There's a banner reminding you about debriefs you owe.

### 📰 News — *what should I know in the next hour?*

Three columns. **Sector**: pick any sector → see headlines for your book names in that sector first, then representative names (e.g. NVDA, AMD if you click Tech-Semis), with per-ticker filter pills. **Ticker search**: type any symbol, get a 7-day Finnhub-tagged feed. **Macro**: real macro news from Finnhub's general feed, auto-categorized into Monetary · Geopolitics · Government · Economy · Energy · Markets. Click any article → AI summarizes in 3 bullets with a "why does this matter to my book" line.

### 🎯 Options Flow — *is smart money getting positioned?*

Chain aggregates for every name in your book + mega-caps + peer-group members. Per-ticker: call/put volume, OI, dollar notional, ATM IV, top 5 contracts by volume/OI ratio. Pre-earnings names (≤10 days out) pinned in an amber section at the top. Click any row → AI "Interpret flow" drawer reads the chain against your thesis: bullish/bearish/mixed bias, evidence cited with specific numbers, whether it confirms or contradicts your stance, what to watch next.

### 📄 Transcripts — *what really happened on the call?*

Paste a transcript, paste a URL (Tavily extracts the page), or upload a PDF (parsed via `unpdf`). The agent returns a multi-section analysis: sentiment vs prior quarter, tone delta, key themes with supporting quotes, **hedging-language flags**, **questions the CEO dodged**, competitive mentions, policy/regulatory mentions, and an explicit "thesis impact" verdict (confirms / strengthens / weakens / breaks).

### 📝 Journal — *what was I thinking, and where do I drift?*

Markdown editor with tag chips (pre-trade, post-trade, thesis-update, macro, meeting-note, earnings-debrief). Autosaves as you type. Click **AI organize** and it extracts trade ideas, thesis changes, action items, and risks into structured rows you can act on. **Weekly summary** runs every Sunday: headline, performance vs your benchmark, thesis status changes, upcoming events, 1–3 specific watch items. After 5+ closed trades, **Pattern analysis** does a coaching pass — what you repeatedly get right, what you repeatedly get wrong (with cited evidence), tier-specific habits, structure-specific patterns, emotional tells.

### 🤖 AI Research — *the agent itself*

The flagship surface. Each T1 ticker gets a card with current status badge, conviction dial, key development one-liner, and a 30-day conviction sparkline. **Run now** fires a 6-step multi-agent pipeline:

```
3 parallel analysts (news/policy · technicals · fundamentals)
                            ↓
                  Bull researcher sees all 3
                            ↓
              Bear researcher sees analysts + bull
                            ↓
   PM synthesizer outputs structured JSON thesis (status,
   conviction, variant view, setup, drivers, catalysts,
   bull/bear cases with target prices, position risks,
   watch list)
```

Each step is small and focused. Total: ~$0.012/ticker on DeepSeek V4 Pro. Sector-aware — when you add `NVDA`, the agent uses the tech-semis persona with SOXX as the benchmark and CHIPS-Act / export-control policy themes. When you add `JPM`, it switches to a banks persona with XLF benchmark, NII sensitivity, and Basel III as the policy focus. Eight built-in industry frames + generalist fallback.

**Generate trade idea** pulls real option chains + next earnings dates + your book size and produces ONE highest-conviction setup with **exact strikes, expiries, contract counts, estimated debit, max loss in dollars, R:R ratio, % of book at risk, entry trigger, time stop, price targets**. Sized inside 0.5%–2% of book by hard rule.

**Ask the agent**: streaming chat with prompt-cached system context. Web search via Tavily, so it can answer real-time questions like *"why is FSLR down 4% today"* by actually looking at today's headlines.

### 💰 P&L — *am I actually any good at this?*

When the AI generates a trade idea you like, star it. The P&L tab tracks every starred idea: entry spot, current spot, direction-adjusted % move (sign flipped for bearish setups), days held, status (Open / Closed). Win rate, average move, days held breakdowns. Closes update conviction back into the agent's track record (future enhancement).

### ⚙️ Settings — *make it yours*

Book size (drives sizing math everywhere). Peer groups (e.g. "Solar modules" = `[FSLR, TE, CSIQ]` affects `[FSLR, TE]` — when CSIQ reports, you get an auto-generated read-through note for your FSLR/TE positions). Macro search terms. Mega-cap watchlist. Ticker-industry refresh button. Notification toggles (thesis flips, urgent read-throughs, unusual options flow). Push registration. Weekly email controls (preview HTML, send now).

---

## A day in the life

**7:30 AM** — You wake up. Your phone has two push notifications:

> **FSLR thesis weakened** — Last night's CSIQ print showed module ASPs slipping to $0.21, vs your $0.25 thesis floor. Click → AI Research tab.

> **FSLR unusual options flow · earnings in 8d** — PUT 230 exp 2026-08-15 — vol 4,200 on OI 800 (5.3x), notional $1.2M. Click → Options Flow tab.

**7:45 AM** — You open the Vercel URL. The Book tab shows FSLR conviction dropped from 7/10 to 5/10 overnight. The thesis card now reads "weakened" with the key development: *CSIQ Q3 print Wed AH revealed downstream pricing pressure not yet in FSLR consensus."*

**8:00 AM** — You click Options Flow → FSLR → "Interpret flow." The agent reads the chain against your thesis: *"Bearish positioning ahead of earnings, evidence: put/call vol 2.1x, $1.2M premium on 230P with 8d to expiry, ATM IV +12 vol since CSIQ print. Contradicts your bullish thesis at current conviction. Watch: whether 230P open interest builds further this week."*

**8:15 AM** — AI Research → FSLR → Run now. The multi-agent pipeline re-runs against last night's data and produces an updated structured thesis. You decide: trim 1/3 of the position before the print, hold 2/3 with a tighter stop. You click "Generate trade idea" — the agent suggests a specific protective put spread sized to $4,200 max loss (2.1% of book).

**Sunday 8 AM** — Your inbox: *"FSLR -3.2% on the week, vs ICLN +0.8%. Position partially trimmed Wednesday saved an estimated $1,800 of damage. Thesis status remains weakened. Two T2 names — ARRY and SHLS — also weakened on the read-through. Upcoming this week: CHPT prints Wed AH..."*

---

## Show me the surfaces

> *(Screenshots coming — drop your own here once you've signed in.)*

```
┌─────────────────────────────────────────────────────────┐
│  THE TERMINAL                                           │
│  BOOK · EARNINGS · NEWS · OPTIONS FLOW · TRANSCRIPTS    │
│  JOURNAL · AI RESEARCH · P&L · SETTINGS                 │
└─────────────────────────────────────────────────────────┘
```

Live demo (you'll need an account to see anything past login):
**https://the-terminal-lilac.vercel.app**

---

## Get running

> 💡 **Run it locally — that's the recommended path.** The multi-agent pipeline does ~6 LLM calls per ticker (~30-60s wall time). Vercel's free Hobby plan kills serverless functions at 60 seconds, so the agent gets truncated on slow LLM days. Running locally via `npm run dev` removes the timeout entirely — every run completes cleanly. Cloud deploy is for "access it from anywhere" — local is for "I want the agent to actually finish thinking."

**[Full step-by-step → SETUP.md](SETUP.md)**

```bash
# Local — recommended for daily research use
git clone https://github.com/ronitg1/the-terminal.git
cd the-terminal
npm install
cp .env.local.example .env.local        # fill in the keys (see SETUP.md)
# Open supabase/setup.sql → paste into Supabase SQL Editor → Run
npm run dev
```

Open `http://localhost:3000` → enter your email → magic link → you're in.

### Local vs cloud

| | Local (`npm run dev`) | Vercel Hobby (free) | Vercel Pro ($20/mo) |
|---|---|---|---|
| Agent runs reliably | ✅ no timeout | ⚠️ 60s cap, partial on slow LLM days | ✅ 300s cap |
| Access from phone / other device | ❌ | ✅ | ✅ |
| Automatic crons (thesis refresh, options scan, Sunday email) | ❌ (run manually) | ⚠️ daily-only + 60s cap | ✅ |
| Push notifications | ⚠️ only when laptop is on | ✅ | ✅ |
| Cost | $0 hosting | $0 | $20/mo |
| Best for | active research at a desk | shared link / demo | always-on alerting |

**Recommendation**: run locally for primary use. If you want push notifications and weekly email to keep working when your laptop is off, deploy to Vercel — and **upgrade to Pro** if you want the cron-driven thesis refreshes to reliably complete.

You can run both at once. The Vercel deploy and your local dev server share the same Supabase database, so your book/journal/theses stay in sync.

### One-click cloud deploy (optional)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ronitg1/the-terminal&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,NEXT_PUBLIC_SITE_URL,LLM_PROVIDER,DEEPSEEK_API_KEY,TAVILY_API_KEY,FINNHUB_API_KEY,CRON_SECRET&envDescription=See%20SETUP.md%20for%20how%20to%20get%20each%20key&envLink=https://github.com/ronitg1/the-terminal/blob/main/SETUP.md)

(Use this if you want a shareable URL — but expect occasional 504s on Hobby. Upgrade to Pro for reliability.)

---

## Stack

- **App**: Next.js 14 App Router · TypeScript strict · React 18 · Tailwind + shadcn
- **Database/Auth**: Supabase (Postgres + RLS + Auth) via `@supabase/ssr`
- **LLM**: DeepSeek V4 Pro (default, ~14× cheaper than Claude) or Anthropic Sonnet/Haiku (fallback). Provider abstraction in [lib/llm.ts](lib/llm.ts).
- **Market data**: `yahoo-finance2` (quotes, options chains, earnings calendar, history). Finnhub for per-ticker news + general market news.
- **Web search/extract**: Tavily (the agent's `web_search` tool).
- **PDF parsing**: `unpdf` (transcripts).
- **Email**: Resend (Sunday recap).
- **Push**: `web-push` + service worker (browser push).

Every LLM call goes through a budget cap ([lib/billing.ts](lib/billing.ts)) — hard-stops at `ANTHROPIC_MONTHLY_BUDGET_USD` (default $5/month). Set a matching cap in your provider console for belt + suspenders.

---

## Why you should fork it

**Bloomberg costs $24,000/year.** You can self-host this for ~$5/month in API costs. The free tiers cover the rest.

**Your data stays yours.** Supabase project under your account. No third-party SaaS that goes out of business in two years and takes your journal with it.

**You can edit the prompts.** The multi-agent pipeline lives in plain code in [lib/agent/multiAgent.ts](lib/agent/multiAgent.ts). Don't like how the bear researcher frames things? Change three lines. Want a new industry frame for, say, crypto miners? Drop it into [industryFrames.ts](lib/agent/industryFrames.ts).

**You can fork the AI provider.** Today it's DeepSeek or Anthropic. Swap the provider abstraction in [lib/llm.ts](lib/llm.ts) for OpenAI, Mistral, a local Llama — whatever your stack tolerates.

**It's a single-user tool by design.** Not a SaaS. No multi-tenant complexity to maintain. RLS isolates accounts so you *can* share with a friend if you want, but the UX assumes you're the only one looking.

---

## Customizing

| What | Where |
|---|---|
| Starting watchlist (runs on first sign-in) | [lib/seed.ts](lib/seed.ts) |
| Industry frames — personas, benchmarks, default tickers | [lib/agent/industryFrames.ts](lib/agent/industryFrames.ts) |
| Multi-agent pipeline | [lib/agent/multiAgent.ts](lib/agent/multiAgent.ts) |
| Trade-idea prompt | [app/api/agent/trade-idea/route.ts](app/api/agent/trade-idea/route.ts) |
| Macro calendar dates | [lib/macro-calendar.ts](lib/macro-calendar.ts) — bump yearly |
| LLM model IDs | [lib/llm.ts](lib/llm.ts) |
| Pricing assumptions | [lib/billing.ts](lib/billing.ts) |
| Per-user macro terms, peer groups, mega caps, book size | Settings tab (no code) |

---

## Costs

| Service | What | Free tier | Realistic monthly |
|---|---|---|---|
| Vercel | Hosting + cron | Hobby plan | $0 |
| Supabase | DB + Auth | 500MB | $0 |
| DeepSeek | LLM | PAYG | $2–5 |
| Tavily | Web search | 1,000/mo | $0 |
| Finnhub | Per-ticker + general news | 60 req/min | $0 |
| Resend | Weekly email | 100/day | $0 |
| **Total** | | | **~$5/month** |

Anthropic fallback adds maybe $30/month if you flip `LLM_PROVIDER=anthropic` for everything. Keep it on DeepSeek unless you want claim-against-Claude prompt nuance.

---

## Security

- Every table has Row-Level Security: `auth.uid() = user_id` policies on SELECT / INSERT / UPDATE / DELETE. Two accounts in the same Supabase project can't read each other's data.
- Cron routes (`/api/agent/cron`, `/api/options-flow/scan`, `/api/email/weekly`) require `Authorization: Bearer $CRON_SECRET`. Without it they 401.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS. Used only in cron routes that fan out to all users. Keep it env-only.
- LLM responses go through a lenient JSON repair pass; the model never executes anything.
- News/transcript links open with `noopener noreferrer`.

---

## Roadmap

These are real gaps if you want a "trading agent" in the algorithmic sense, not a research dashboard. None are dealbreakers for the discretionary use case but they're where the next big wins are:

1. **Portfolio mode** — track actual positions (manual entry → broker API later) so trade-idea gen enforces real concentration limits instead of sizing against a fictional book.
2. **Continuous news watcher** — websocket/poll Finnhub → fire the agent on book hits within minutes (not on cron).
3. **SEC filings tool** — 8-K parser fed to the agent + push on material events.
4. **Hypothesis register** — agent emits 3–5 falsifiable claims per thesis; grade them at next earnings; conviction recalibrates from the hit rate. (This is the closest thing to "the agent learns from its own track record.")
5. **Backtest harness** — replay stored thesis snapshots against subsequent price action.

---

## License

[MIT](LICENSE). Use it, fork it, run your own.

**Not financial advice.** Trading involves substantial risk. Past performance does not guarantee future results. The AI is a research assistant, not an oracle.

---

If you fork this and ship something interesting, open a PR or tag me — I'd love to see it.
