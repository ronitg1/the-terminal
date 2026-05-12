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
