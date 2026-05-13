# The Terminal

> **A Bloomberg-style equity research and earnings-trading dashboard for a single investor.** Multi-agent AI thesis, options flow, transcripts, journal, and concrete trade plans — all under your own login.

---

## What you get

| | |
|---|---|
| **Book** | Dense ticker table · IV history · 60-day correlation · personalized sector ETF flows |
| **Earnings** | Week/month calendar · pre-earnings checklist + position sizer · post-earnings debrief |
| **News** | Sector taxonomy → headlines · ticker search · macro/econ-only feed |
| **Options Flow** | Chain aggregates · pre-earnings flag · "Interpret flow" AI |
| **Transcripts** | Paste / URL / PDF → multi-section AI analysis |
| **Journal** | Markdown editor · AI organize · weekly summary · pattern analysis |
| **AI Research** | Multi-agent thesis (3 analysts → bull → bear → PM) · trade ideas with dollar sizing, R:R, max loss |
| **P&L** | Tracks the AI-generated trade ideas you starred |

Plus background workers: thesis refresh 2×/day · pre-earnings options scan 3×/day · Sunday recap email · browser push notifications.

---

## Get it running in 10 minutes

If you just want to run it locally and try it — **[follow SETUP.md](SETUP.md)**. Step-by-step, with screenshots-worth of detail for each service.

The TL;DR version:

```bash
# 1. Clone + install
git clone https://github.com/<your-username>/the-terminal.git
cd the-terminal
npm install

# 2. Copy env template
cp .env.local.example .env.local
# (fill in keys — see SETUP.md)

# 3. Run the database setup
# Open Supabase SQL Editor → paste contents of supabase/setup.sql → Run

# 4. Boot it
npm run dev
```

Open `http://localhost:3000`, enter your email, click the magic link, you're in.

---

## Deploy to Vercel (one click)

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/ronitg1/the-terminal&env=NEXT_PUBLIC_SUPABASE_URL,NEXT_PUBLIC_SUPABASE_ANON_KEY,SUPABASE_SERVICE_ROLE_KEY,NEXT_PUBLIC_SITE_URL,LLM_PROVIDER,DEEPSEEK_API_KEY,TAVILY_API_KEY,FINNHUB_API_KEY,CRON_SECRET&envDescription=See%20SETUP.md%20for%20how%20to%20get%20each%20key&envLink=https://github.com/ronitg1/the-terminal/blob/main/SETUP.md)

You'll need accounts at Supabase, DeepSeek, Tavily, and Finnhub (all free tiers work). Full walkthrough → [SETUP.md](SETUP.md).

---

## Required services

All free tiers are sufficient for one user:

| Service | What it powers | Sign up | Cost |
|---|---|---|---|
| [Supabase](https://supabase.com) | Auth + database | Free 500MB | $0 |
| [DeepSeek](https://platform.deepseek.com) | LLM (default) | Pay-as-you-go | ~$2-5/mo |
| [Tavily](https://tavily.com) | Web search for AI chat | 1000 free/mo | $0 |
| [Finnhub](https://finnhub.io) | Per-ticker news | 60 req/min free | $0 |
| Vercel | Hosting (optional) | Hobby plan | $0 |

Optional add-ons:

| Service | What it powers |
|---|---|
| [Anthropic](https://console.anthropic.com) | LLM fallback (set `LLM_PROVIDER=anthropic`) |
| [NewsAPI](https://newsapi.org) | Macro/sector news (localhost only on free tier) |
| [Resend](https://resend.com) | Weekly Sunday recap email |
| [Web Push VAPID](https://web-push-codelab.glitch.me/) | Browser push notifications |

---

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind + shadcn · Supabase (Postgres + Auth + RLS) · `yahoo-finance2` · DeepSeek/Anthropic SDK · Recharts · Resend · web-push.

Architecture overview is in [SETUP.md → Architecture](SETUP.md#architecture). The original handoff doc with all design decisions is at [HANDOFF.md](HANDOFF.md).

---

## Why this exists

This is built for **one discretionary investor** running their own small book — not a multi-tenant SaaS. Each Supabase account gets its own data under RLS, but the UX assumes you're the only person who will see it. Fork it, edit `lib/seed.ts` to your starting basket, change the [industry frames](lib/agent/industryFrames.ts) to match your beat, and the AI personas adjust automatically.

Real users care about three things: **what is true about my book right now**, **what should I do today**, **what should I watch this week**. Every surface answers one of those.

---

## Security

- Every table has Row-Level Security: `auth.uid() = user_id` policies on SELECT / INSERT / UPDATE / DELETE.
- Cron routes (`/api/agent/cron`, `/api/options-flow/scan`, `/api/email/weekly`) require `Authorization: Bearer $CRON_SECRET`.
- `SUPABASE_SERVICE_ROLE_KEY` bypasses RLS — it's only used in cron routes that need to fan out to all users. Keep it env-only.
- Monthly LLM spend is hard-capped at `ANTHROPIC_MONTHLY_BUDGET_USD` (default $5). Set a matching limit in your DeepSeek/Anthropic console for a true hard stop.

---

## License

MIT — see [LICENSE](LICENSE). Not financial advice. Trade at your own risk.
