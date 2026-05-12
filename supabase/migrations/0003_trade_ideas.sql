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
