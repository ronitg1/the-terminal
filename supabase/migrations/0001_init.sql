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
