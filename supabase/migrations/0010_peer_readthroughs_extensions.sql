-- Phase 2 — extend peer_readthroughs with structured metadata (urgency,
-- bullet points, group label, reporter's report date) stored as jsonb so the
-- News tab banner can render rich detail without schema churn.

alter table public.peer_readthroughs
  add column if not exists data jsonb not null default '{}'::jsonb;

create index if not exists peer_readthroughs_user_recent_idx
  on public.peer_readthroughs (user_id, generated_at desc);
