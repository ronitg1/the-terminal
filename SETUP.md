# Setup guide

Follow this top-to-bottom. Total time: **~15 minutes** for the local setup, **+10 minutes** if you also deploy to Vercel.

Each step says what you're about to do, what's free, and what to do if something goes wrong.

---

## What you need before starting

- Node.js 18+ ([download](https://nodejs.org)) — `node --version` should print 18 or higher
- Git ([download](https://git-scm.com)) — most systems have this already
- A working email address (for the Supabase magic link sign-in)

---

## Step 1 — Get the code

```bash
git clone https://github.com/ronitg1/the-terminal.git
cd the-terminal
npm install
```

`npm install` takes ~30 seconds on a fast connection. You'll see a few audit warnings — they're for transitive deps and don't affect anything.

---

## Step 2 — Create your Supabase project (5 min)

Supabase is the database + login provider. Free tier: 500MB storage, 50K monthly users — way more than you'll need.

1. Go to [supabase.com](https://supabase.com) → **Start your project** → sign in with GitHub.
2. Click **New Project**:
   - **Name**: anything, e.g. `the-terminal`
   - **Database Password**: generate one and save it (you won't need it for this app, but Supabase requires it)
   - **Region**: pick the closest one
3. Wait ~1 minute for the project to spin up.

### Run the database setup

1. In your Supabase project sidebar, click **SQL Editor**.
2. Click **+ New query**.
3. Open `supabase/setup.sql` from this repo, copy the **entire** contents (Ctrl/Cmd-A → Ctrl/Cmd-C).
4. Paste into the SQL editor and click **Run** (bottom right, or Ctrl/Cmd-Enter).
5. You should see "Success. No rows returned." — that means it worked.

This creates all 14 tables and their RLS policies in one shot. It's idempotent, so re-running is safe if you ever need to.

### Grab your API keys

1. Sidebar → **Project Settings** (gear icon) → **API**.
2. Copy three values:

| Field on Supabase | Goes into `.env.local` as |
|---|---|
| **Project URL** | `NEXT_PUBLIC_SUPABASE_URL` |
| **anon public** key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| **service_role** secret (click "Reveal") | `SUPABASE_SERVICE_ROLE_KEY` |

> ⚠️ The `service_role` key bypasses Row-Level Security. **Never** put it in client-side code, frontend env vars, or commit it. The `.env.local` file is already gitignored.

### Enable email magic-link auth

1. Sidebar → **Authentication** → **Providers** → **Email**.
2. Toggle **Enable Email provider** → ON.
3. Toggle **Enable Email Confirmations** → OFF for local dev (so the magic link works without a custom email template). You can flip this on later for production.
4. Click **Save**.

---

## Step 3 — Get your data + AI keys (5 min)

You need at least these four. All have working free tiers.

### DeepSeek (primary LLM — ~$2-5/mo with light use)

1. Sign up at [platform.deepseek.com](https://platform.deepseek.com).
2. Add a payment method (PAYG, no monthly fee).
3. **Top up $5** — that's a lot of usage at DeepSeek's prices ($0.43 per million input tokens).
4. Sidebar → **API Keys** → **Create new** → copy.
5. Goes into `.env.local` as `DEEPSEEK_API_KEY`.

> Optional: in DeepSeek Console → **Billing**, set a hard monthly spend limit (e.g. $10) for safety.

### Tavily (web search for AI chat — free tier)

1. Sign up at [tavily.com](https://tavily.com). Free tier = 1000 searches/month, plenty.
2. Dashboard → **API Keys** → copy the default key.
3. Goes into `.env.local` as `TAVILY_API_KEY`.

### Finnhub (per-ticker news — free tier)

1. Sign up at [finnhub.io](https://finnhub.io). Free tier = 60 requests/minute.
2. Right after signup, the dashboard shows your API key on the home page.
3. Goes into `.env.local` as `FINNHUB_API_KEY`.

### NewsAPI (optional — macro feed; localhost only on free tier)

1. Sign up at [newsapi.org](https://newsapi.org).
2. Get your API key from the dashboard.
3. Goes into `.env.local` as `NEWS_API_KEY`.

> Skip this if you don't care about the macro column. The free tier blocks production calls.

---

## Step 4 — Fill in `.env.local`

In the project root:

```bash
cp .env.local.example .env.local
```

Open `.env.local` in any editor and fill in the values you just collected. **At minimum**, set:

```ini
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
NEXT_PUBLIC_SITE_URL=http://localhost:3000

LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=sk-...
TAVILY_API_KEY=tvly-...

FINNHUB_API_KEY=...
```

Save the file. Don't worry about the optional sections (Anthropic, Resend, VAPID, CRON_SECRET) yet — the app boots without them.

---

## Step 5 — Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

1. You'll see the sign-in screen. Enter your email.
2. Check your inbox for a magic link (subject: "Confirm Your Signup"). Click it.
3. You're in. The app seeds a starter watchlist spanning a few sectors the first time so the multi-agent pipeline can demonstrate its sector-awareness. Replace with your real names from the Book tab.

**To customize your starting basket**: edit `lib/seed.ts` BEFORE first sign-in, or just add/remove tickers via Book → Add ticker after you're in.

---

## Optional features

### Anthropic fallback (if you'd rather use Claude than DeepSeek)

1. Get an API key at [console.anthropic.com](https://console.anthropic.com).
2. In `.env.local`:
   ```ini
   ANTHROPIC_API_KEY=sk-ant-...
   LLM_PROVIDER=anthropic
   ```
3. Restart `npm run dev`. Costs ~10× more than DeepSeek; better on policy nuance.

### Weekly Sunday recap email (Resend)

1. Sign up at [resend.com](https://resend.com). Free tier = 100 emails/day.
2. **Settings → API Keys → Create**. Copy.
3. In `.env.local`:
   ```ini
   RESEND_API_KEY=re_...
   RESEND_FROM_EMAIL=The Terminal <onboarding@resend.dev>
   ```
   The sandbox sender (`onboarding@resend.dev`) only delivers to your Resend account email. For a custom address, add + verify a domain at Resend → **Domains**.
4. Restart. Go to **Settings → Weekly email recap → Send to my email now**. Should land in your inbox within ~30 seconds.

### Browser push notifications

1. Generate a VAPID keypair:
   ```bash
   npx web-push generate-vapid-keys
   ```
   You'll see two long strings. Copy them.
2. In `.env.local`:
   ```ini
   VAPID_PUBLIC_KEY=BO...
   VAPID_PRIVATE_KEY=...
   VAPID_SUBJECT=mailto:you@yourdomain.com
   ```
3. Restart. Go to **Settings → Notifications → Enable on this browser** → grant permission → **Send test**. A notification should appear.

What triggers a push:
- Cron thesis runs flag a `weakened` or `broken` status (only fires on Vercel where cron runs).
- Peer read-through generator hits "act before open" urgency.
- Options-flow scan finds unusual chain activity on T1 names with earnings ≤10 days.

---

## Deploy to Vercel

Once everything works locally, deploying takes ~10 minutes.

### 1. Push your code to GitHub

If you haven't forked already, do that first via [github.com/new](https://github.com/new). Then:

```bash
git remote add origin https://github.com/<your-username>/<your-repo>.git
git push -u origin main
```

### 2. Import to Vercel

Use the one-click button in the README, or:

1. Go to [vercel.com/new](https://vercel.com/new).
2. Import your GitHub repo. Framework auto-detects as Next.js.
3. **Add every env var** from your `.env.local` to Vercel:
   - Project Settings → **Environment Variables** → paste each one.
   - For `NEXT_PUBLIC_SITE_URL`, use your Vercel production URL (e.g. `https://the-terminal-yours.vercel.app`).
   - Generate a fresh `CRON_SECRET`:
     ```bash
     openssl rand -hex 32          # macOS/Linux
     # OR on Windows PowerShell:
     [Convert]::ToHexString([byte[]](1..32 | %{Get-Random -Maximum 256}))
     ```
4. Click **Deploy**.

### 3. Configure Supabase to allow your Vercel URL

1. Supabase Dashboard → **Authentication → URL Configuration**.
2. Set **Site URL** to your Vercel URL.
3. Add the same URL (and `<vercel-url>/auth/callback`) to **Redirect URLs**.

### 4. Crons start firing automatically

Vercel reads `vercel.json` and schedules:

| Path | Schedule (UTC) | What it does |
|---|---|---|
| `/api/agent/cron` | `0 12,21 * * 1-5` | Refresh thesis for every user's T1 tickers, push on status flips |
| `/api/options-flow/scan` | `0 13,17,20 * * 1-5` | Scan T1 tickers ≤10d to earnings for unusual options activity |
| `/api/email/weekly` | `0 13 * * 0` | Send Sunday recap to every user |

To trigger any of these manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DEPLOY.vercel.app/api/agent/cron
```

---

## Architecture

```
app/
  (auth)/                 login + magic-link callback
  (app)/                  authenticated routes (one folder per tab)
  api/                    server endpoints
lib/
  supabase/               server, browser, admin (service-role) clients
  providers/              yahoo, finnhub, tavily, news, etf-flows, scraping
  agent/                  multiAgent · industryFrames · thesisPrompt · jsonRepair · …
  llm.ts                  DeepSeek + Anthropic provider abstraction
  billing.ts              monthly budget cap + usage tracking
  email.ts                Resend wrapper (no-ops when key missing)
  push.ts                 web-push wrapper + dead-subscription cleanup
  settings.ts             user_settings types/CRUD
  macro-calendar.ts       hardcoded FOMC/CPI/jobs dates (edit yearly)
components/               one folder per surface (book/, earnings/, …) + ui/ primitives
public/sw-push.js         service worker for browser push
supabase/
  migrations/             14 numbered files, idempotent
  setup.sql               all migrations concatenated — paste once on fresh install
```

The big-picture design notes (multi-agent pipeline, industry frames, JSON repair pass, monthly budget cap, cron schedule) live in inline comments at the top of each `lib/agent/*.ts` and `lib/llm.ts` / `lib/billing.ts` file.

---

## Customizing

| What | Where |
|---|---|
| Starting watchlist | [lib/seed.ts](lib/seed.ts) — runs on first sign-in if user has no tickers |
| Industry frames (personas, benchmarks, default tickers per sector) | [lib/agent/industryFrames.ts](lib/agent/industryFrames.ts) |
| Macro calendar dates | [lib/macro-calendar.ts](lib/macro-calendar.ts) — bump yearly |
| Per-user macro search terms, peer groups, mega caps, book size | Settings tab (no code changes needed) |
| LLM models | [lib/llm.ts](lib/llm.ts) `MODEL_IDS` |
| Pricing assumptions | [lib/billing.ts](lib/billing.ts) `PRICING` |

---

## Troubleshooting

**Magic link goes to `localhost:3000` but I'm on Vercel.**
You forgot to set `NEXT_PUBLIC_SITE_URL` in Vercel env, or didn't add the Vercel URL to Supabase → Auth → URL Configuration.

**"401 Unauthorized" on every API call after sign-in.**
The Supabase service role key in `.env.local` is wrong. Double-check that it's the `service_role` (decoded JWT shows `role: "service_role"`), not the `anon` key.

**Cron not firing on Vercel.**
You're on the Hobby plan and the cron is over 6 invocations/day, or `CRON_SECRET` doesn't match between Vercel env and what Vercel sends. Check Vercel → Deployments → Crons.

**LLM calls error with "BudgetExceededError".**
You hit the monthly cap. Raise `ANTHROPIC_MONTHLY_BUDGET_USD` or wait until the 1st.

**"No fundamentals data found for symbol: ICLN" in logs.**
Harmless. ETFs don't have fundamentals; the providers catch and skip these.

**Push notifications "permission denied" can't be undone.**
Click the lock icon in the browser address bar → site permissions → reset Notifications. Then re-click "Enable on this browser".

---

## What's the LLM doing under the hood?

The multi-agent thesis pipeline ([lib/agent/multiAgent.ts](lib/agent/multiAgent.ts)) is the centerpiece:

1. **3 parallel analysts** (news/policy, technicals, fundamentals) each produce a short read.
2. **Bull researcher** sees all three analyst outputs, makes the bullish case with a target price.
3. **Bear researcher** sees analysts + bull, makes the bearish case with a target price.
4. **PM synthesizer** sees everything, outputs a structured JSON: status (intact/strengthened/weakened/broken), conviction 1-10, variant view, setup, drivers, catalysts, position risks, what to watch.

Each step is a small focused LLM call (~1.5K in, 0.8K out). Total ≈ 6 calls per ticker per run = ~$0.012 on DeepSeek V4 Pro.

The trade idea generator ([app/api/agent/trade-idea/route.ts](app/api/agent/trade-idea/route.ts)) is a separate single-shot pipeline that ingests the latest thesis snapshots + live option chains + earnings dates and produces ONE highest-conviction trade plan with exact strikes, expiries, dollar sizing tied to your book size, R:R, max loss in USD, entry/exit triggers.

The "Interpret flow" buttons on the Book and Options Flow tabs feed the relevant data slice + your book context to a structured-output LLM call. Same pattern for News article summaries and Journal pattern analysis.

Everything goes through [lib/llm.ts](lib/llm.ts) which abstracts DeepSeek vs Anthropic and reports usage in a unified shape to [lib/billing.ts](lib/billing.ts) for cost tracking.
