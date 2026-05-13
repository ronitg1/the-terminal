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
