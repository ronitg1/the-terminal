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
