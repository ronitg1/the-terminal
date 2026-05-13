-- Phase 2 — journal extensions: one entry per (user_id, date) so upserts work
-- cleanly, plus an updated_at timestamp for autosave display.

alter table public.journal_entries
  add column if not exists updated_at timestamptz not null default now();

-- Enforce one row per (user_id, date) so client can PUT/upsert by natural key.
-- If duplicates already exist, this will fail — but the table is empty at this
-- point in the build, so it's safe.
alter table public.journal_entries
  add constraint journal_entries_user_date_unique unique (user_id, date);
