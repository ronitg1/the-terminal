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
