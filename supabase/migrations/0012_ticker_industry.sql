-- Phase 2 — per-ticker industry + sector classification so the agent can pick
-- the right "frame" (benchmark ETF, policy themes, persona). Auto-populated
-- from Yahoo on ticker add and lazily on first agent run if missing.

alter table public.tickers
  add column if not exists sector text,
  add column if not exists industry text,
  add column if not exists frame_id text,                -- pinned override of the auto-picked frame
  add column if not exists benchmark_symbol text;        -- explicit benchmark override (e.g. "SOXX")

create index if not exists tickers_user_sector_idx on public.tickers (user_id, sector);
