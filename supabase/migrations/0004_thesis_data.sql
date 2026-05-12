-- Phase 2a — structured PM-grade thesis fields stored as jsonb alongside the
-- existing free-text `content` body. Older snapshots without `data` continue
-- to render via fallback to `content`.

alter table public.thesis_snapshots
  add column if not exists data jsonb not null default '{}'::jsonb;
