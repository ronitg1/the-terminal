-- ============================================================================
-- The Terminal — full database setup (run once)
-- ============================================================================
-- HOW TO USE:
--   1. Open Supabase Dashboard → your project → SQL Editor
--   2. Paste this ENTIRE file into a new query
--   3. Click "Run"  (it takes ~5 seconds)
--   4. You're done. All 14 migrations are idempotent so re-running is safe.
--
-- This file is a concatenation of every file in supabase/migrations/. If you
-- ever need to apply a single migration (e.g. after pulling new changes), you
-- can either: (a) re-run this whole file (idempotent), or (b) run only the
-- new file from supabase/migrations/.
-- ============================================================================

-- ============================================================================
-- ==  0001_init.sql
-- ============================================================================
-- The Terminal — initial schema
-- Single-user app with Supabase Auth. Every table is keyed to auth.users(id) via user_id.
-- RLS enabled with auth.uid() = user_id policies for SELECT/INSERT/UPDATE/DELETE.

create extension if not exists "pgcrypto";

-- ============================================================================
-- tickers
-- ============================================================================
create table public.tickers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  name text,
  tier smallint not null check (tier between 1 and 3),
  notes text default '',
  created_at timestamptz not null default now(),
  unique (user_id, symbol)
);
create index tickers_user_tier_idx on public.tickers (user_id, tier, symbol);

-- ============================================================================
-- journal_entries
-- ============================================================================
create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  content text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);
create index journal_user_date_idx on public.journal_entries (user_id, date desc);

-- ============================================================================
-- thesis_snapshots
-- ============================================================================
create table public.thesis_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  content text not null default '',
  sources jsonb not null default '[]'::jsonb,
  status text not null default 'intact' check (status in ('intact','strengthened','weakened','broken')),
  conviction smallint check (conviction between 1 and 10),
  generated_at timestamptz not null default now()
);
create index thesis_user_symbol_idx on public.thesis_snapshots (user_id, symbol, generated_at desc);

-- ============================================================================
-- watchlist_alerts
-- ============================================================================
create table public.watchlist_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  condition text not null,
  triggered_at timestamptz,
  created_at timestamptz not null default now()
);
create index alerts_user_symbol_idx on public.watchlist_alerts (user_id, symbol);

-- ============================================================================
-- earnings_events
-- ============================================================================
create table public.earnings_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  report_date date not null,
  timing text check (timing in ('BH','AH')),
  eps_estimate numeric,
  rev_estimate numeric,
  implied_move_pct numeric,
  actual_eps numeric,
  actual_rev numeric,
  stock_reaction_pct numeric,
  checklist_data jsonb not null default '{}'::jsonb,
  debrief_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index earnings_user_date_idx on public.earnings_events (user_id, report_date desc);
create index earnings_user_symbol_idx on public.earnings_events (user_id, symbol, report_date desc);

-- ============================================================================
-- trades
-- ============================================================================
create table public.trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  direction text check (direction in ('long','short')),
  structure text check (structure in ('straddle','vertical','call','put','stock')),
  entry_date date,
  exit_date date,
  entry_price numeric,
  exit_price numeric,
  pnl numeric,
  notes text default '',
  created_at timestamptz not null default now()
);
create index trades_user_symbol_idx on public.trades (user_id, symbol, entry_date desc);

-- ============================================================================
-- short_interest
-- ============================================================================
create table public.short_interest (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  si_pct numeric,
  days_to_cover numeric,
  fetched_at timestamptz not null default now()
);
create index si_user_symbol_idx on public.short_interest (user_id, symbol, fetched_at desc);

-- ============================================================================
-- options_flow
-- ============================================================================
create table public.options_flow (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  expiry date,
  strike numeric,
  type text check (type in ('call','put')),
  size integer,
  premium numeric,
  sentiment text,
  flagged_unusual boolean not null default false,
  fetched_at timestamptz not null default now()
);
create index flow_user_symbol_idx on public.options_flow (user_id, symbol, fetched_at desc);

-- ============================================================================
-- estimate_revisions
-- ============================================================================
create table public.estimate_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  period text,
  eps_estimate numeric,
  revision_direction text check (revision_direction in ('up','down','unchanged')),
  analyst_count integer,
  fetched_at timestamptz not null default now()
);
create index revisions_user_symbol_idx on public.estimate_revisions (user_id, symbol, fetched_at desc);

-- ============================================================================
-- etf_flows
-- ============================================================================
create table public.etf_flows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  flow_usd numeric,
  aum numeric,
  fetched_at timestamptz not null default now()
);
create index etf_flows_user_symbol_idx on public.etf_flows (user_id, symbol, fetched_at desc);

-- ============================================================================
-- transcript_analyses
-- ============================================================================
create table public.transcript_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  earnings_event_id uuid references public.earnings_events(id) on delete cascade,
  raw_transcript text,
  sentiment_score real,
  tone_delta text,
  key_themes jsonb not null default '[]'::jsonb,
  dodged_questions jsonb not null default '[]'::jsonb,
  guidance_language text,
  generated_at timestamptz not null default now()
);
create index transcripts_user_event_idx on public.transcript_analyses (user_id, earnings_event_id);

-- ============================================================================
-- peer_readthroughs
-- ============================================================================
create table public.peer_readthroughs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  reporting_symbol text not null,
  affected_symbol text not null,
  summary text,
  sentiment text check (sentiment in ('positive','negative','neutral')),
  generated_at timestamptz not null default now()
);
create index readthroughs_user_idx on public.peer_readthroughs (user_id, generated_at desc);

-- ============================================================================
-- scrape_errors — observability for graceful-fallback requirement
-- ============================================================================
create table public.scrape_errors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  source text not null,
  symbol text,
  message text,
  attempt integer,
  occurred_at timestamptz not null default now()
);
create index scrape_errors_source_idx on public.scrape_errors (source, occurred_at desc);

-- ============================================================================
-- RLS
-- ============================================================================
alter table public.tickers              enable row level security;
alter table public.journal_entries      enable row level security;
alter table public.thesis_snapshots     enable row level security;
alter table public.watchlist_alerts     enable row level security;
alter table public.earnings_events      enable row level security;
alter table public.trades               enable row level security;
alter table public.short_interest       enable row level security;
alter table public.options_flow         enable row level security;
alter table public.estimate_revisions   enable row level security;
alter table public.etf_flows            enable row level security;
alter table public.transcript_analyses  enable row level security;
alter table public.peer_readthroughs    enable row level security;
alter table public.scrape_errors        enable row level security;

do $$
declare
  t text;
  tbls text[] := array[
    'tickers','journal_entries','thesis_snapshots','watchlist_alerts',
    'earnings_events','trades','short_interest','options_flow',
    'estimate_revisions','etf_flows','transcript_analyses','peer_readthroughs','scrape_errors'
  ];
begin
  foreach t in array tbls loop
    execute format('create policy %I_select on public.%I for select using (auth.uid() = user_id)', t || '_sel', t);
    execute format('create policy %I_insert on public.%I for insert with check (auth.uid() = user_id)', t || '_ins', t);
    execute format('create policy %I_update on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t || '_upd', t);
    execute format('create policy %I_delete on public.%I for delete using (auth.uid() = user_id)', t || '_del', t);
  end loop;
end $$;


-- ============================================================================
-- ==  0002_claude_usage.sql
-- ============================================================================
-- Phase 2a — per-call Claude API usage log used to enforce the monthly budget cap.

create table public.claude_usage (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  model text not null,
  endpoint text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_read_tokens integer not null default 0,
  cache_creation_tokens integer not null default 0,
  cost_usd numeric not null default 0,
  occurred_at timestamptz not null default now()
);

create index claude_usage_month_idx on public.claude_usage (occurred_at desc);
create index claude_usage_user_month_idx on public.claude_usage (user_id, occurred_at desc);

alter table public.claude_usage enable row level security;

-- Users can read their own usage (for the UI indicator).
create policy claude_usage_sel on public.claude_usage
  for select using (auth.uid() = user_id);

-- Inserts done by the service-role key (server-side accounting). No insert policy
-- for end-users — they cannot fabricate usage rows.


-- ============================================================================
-- ==  0003_trade_ideas.sql
-- ============================================================================
-- Phase 2a — persisted AI-generated trade ideas so the user can review history.

create table public.trade_ideas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  symbol text not null,
  rationale text,
  structure text,
  strike_guidance text,
  sizing text,
  risks jsonb not null default '[]'::jsonb,
  trim_on_beat text,
  stop_on_miss text,
  raw jsonb,
  generated_at timestamptz not null default now()
);

create index trade_ideas_user_date_idx on public.trade_ideas (user_id, generated_at desc);

alter table public.trade_ideas enable row level security;

create policy trade_ideas_sel on public.trade_ideas
  for select using (auth.uid() = user_id);
create policy trade_ideas_ins on public.trade_ideas
  for insert with check (auth.uid() = user_id);
create policy trade_ideas_del on public.trade_ideas
  for delete using (auth.uid() = user_id);


-- ============================================================================
-- ==  0004_thesis_data.sql
-- ============================================================================
-- Phase 2a — structured PM-grade thesis fields stored as jsonb alongside the
-- existing free-text `content` body. Older snapshots without `data` continue
-- to render via fallback to `content`.

alter table public.thesis_snapshots
  add column if not exists data jsonb not null default '{}'::jsonb;


-- ============================================================================
-- ==  0005_claude_usage_insert.sql
-- ============================================================================
-- Phase 2a — allow the user's own session to insert into claude_usage.
-- (Postgres doesn't support CREATE POLICY IF NOT EXISTS, so drop first.)

drop policy if exists claude_usage_ins on public.claude_usage;
create policy claude_usage_ins on public.claude_usage
  for insert with check (auth.uid() = user_id);

drop policy if exists claude_usage_del on public.claude_usage;
create policy claude_usage_del on public.claude_usage
  for delete using (auth.uid() = user_id);


-- ============================================================================
-- ==  0006_track_trade_ideas.sql
-- ============================================================================
-- Phase 2a — let the user mark AI-generated trade ideas as "tracked" so a
-- performance dashboard can show how each idea has done since it was flagged.

alter table public.trade_ideas
  add column if not exists is_tracked boolean not null default false,
  add column if not exists tracked_at timestamptz,
  add column if not exists entry_spot_price numeric,
  add column if not exists closed_at timestamptz,
  add column if not exists closed_spot_price numeric,
  add column if not exists tracking_notes text;

create index if not exists trade_ideas_tracked_idx
  on public.trade_ideas (user_id, is_tracked, tracked_at desc);


-- ============================================================================
-- ==  0007_trade_ideas_update_policy.sql
-- ============================================================================
-- Phase 2a — trade_ideas originally only had SELECT/INSERT/DELETE policies.
-- The new tracking feature needs UPDATE (mark as tracked / closed). Without
-- this, RLS silently blocks the update and the API returns 200 with zero rows
-- affected, which is what was happening when the user clicked Track.

drop policy if exists trade_ideas_upd on public.trade_ideas;
create policy trade_ideas_upd on public.trade_ideas
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ============================================================================
-- ==  0008_transcript_extensions.sql
-- ============================================================================
-- Phase 2 — extend transcript_analyses for the structured analysis output.
-- The base table from migration 0001 only covers a subset of the fields the
-- transcript analyzer produces (sentiment, tone_delta, key_themes, dodged_questions,
-- guidance_language). The rest (competitive mentions, policy mentions, thesis
-- impact, watch-next, etc.) goes into `data jsonb`. We also add `symbol` so we
-- can look up transcripts by ticker without going through earnings_events.

alter table public.transcript_analyses
  add column if not exists symbol text,
  add column if not exists data jsonb not null default '{}'::jsonb;

create index if not exists transcript_user_symbol_idx
  on public.transcript_analyses (user_id, symbol, generated_at desc);


-- ============================================================================
-- ==  0009_user_settings.sql
-- ============================================================================
-- Phase 2 — per-user settings: peer groups, macro search terms, mega caps,
-- notification preferences. Stored as a single jsonb blob keyed by user_id so
-- we can extend without schema churn.

create table public.user_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;

drop policy if exists user_settings_sel on public.user_settings;
create policy user_settings_sel on public.user_settings
  for select using (auth.uid() = user_id);

drop policy if exists user_settings_ins on public.user_settings;
create policy user_settings_ins on public.user_settings
  for insert with check (auth.uid() = user_id);

drop policy if exists user_settings_upd on public.user_settings;
create policy user_settings_upd on public.user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists user_settings_del on public.user_settings;
create policy user_settings_del on public.user_settings
  for delete using (auth.uid() = user_id);


-- ============================================================================
-- ==  0010_peer_readthroughs_extensions.sql
-- ============================================================================
-- Phase 2 — extend peer_readthroughs with structured metadata (urgency,
-- bullet points, group label, reporter's report date) stored as jsonb so the
-- News tab banner can render rich detail without schema churn.

alter table public.peer_readthroughs
  add column if not exists data jsonb not null default '{}'::jsonb;

create index if not exists peer_readthroughs_user_recent_idx
  on public.peer_readthroughs (user_id, generated_at desc);


-- ============================================================================
-- ==  0011_journal_extensions.sql
-- ============================================================================
-- Phase 2 — journal extensions: one entry per (user_id, date) so upserts work
-- cleanly, plus an updated_at timestamp for autosave display.

alter table public.journal_entries
  add column if not exists updated_at timestamptz not null default now();

-- Enforce one row per (user_id, date) so client can PUT/upsert by natural key.
-- If duplicates already exist, this will fail — but the table is empty at this
-- point in the build, so it's safe.
alter table public.journal_entries
  add constraint journal_entries_user_date_unique unique (user_id, date);


-- ============================================================================
-- ==  0012_ticker_industry.sql
-- ============================================================================
-- Phase 2 — per-ticker industry + sector classification so the agent can pick
-- the right "frame" (benchmark ETF, policy themes, persona). Auto-populated
-- from Yahoo on ticker add and lazily on first agent run if missing.

alter table public.tickers
  add column if not exists sector text,
  add column if not exists industry text,
  add column if not exists frame_id text,                -- pinned override of the auto-picked frame
  add column if not exists benchmark_symbol text;        -- explicit benchmark override (e.g. "SOXX")

create index if not exists tickers_user_sector_idx on public.tickers (user_id, sector);


-- ============================================================================
-- ==  0013_push_subscriptions.sql
-- ============================================================================
-- Phase 2 — browser push subscriptions for thesis status changes, urgent peer
-- read-throughs, and pre-earnings unusual options flow. One row per (user,
-- endpoint) tuple; multiple browsers/devices per user is allowed.

create table if not exists public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  unique (user_id, endpoint)
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists push_subscriptions_sel on public.push_subscriptions;
create policy push_subscriptions_sel on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists push_subscriptions_ins on public.push_subscriptions;
create policy push_subscriptions_ins on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists push_subscriptions_upd on public.push_subscriptions;
create policy push_subscriptions_upd on public.push_subscriptions
  for update using (auth.uid() = user_id);

drop policy if exists push_subscriptions_del on public.push_subscriptions;
create policy push_subscriptions_del on public.push_subscriptions
  for delete using (auth.uid() = user_id);


-- ============================================================================
-- ==  0014_etf_flows_price.sql
-- ============================================================================
-- Phase 2 — sector ETF flow inference now uses Yahoo (AUM + price) and
-- computes net flow as AUM delta minus price-return-explained AUM change. We
-- store the spot price alongside AUM so we can decompose against a baseline
-- snapshot a week back.

alter table public.etf_flows
  add column if not exists price numeric,
  add column if not exists shares_outstanding numeric;


