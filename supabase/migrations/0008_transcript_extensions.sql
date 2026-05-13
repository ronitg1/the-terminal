-- Phase 2 — extend transcript_analyses for the structured analysis output.
-- The base table from migration 0001 only covers a subset of the fields the
-- transcript analyzer produces (sentiment, tone_delta, key_themes, dodged_questions,
-- guidance_language). The rest (competitive mentions, policy mentions, thesis
-- impact, watch-next, etc.) goes into `data jsonb`. We also add `symbol` so we
-- can look up transcripts by ticker without going through earnings_events.

alter table public.transcript_analyses
  add column if not exists symbol text,
  add column if not exists data jsonb not null default '{}'::jsonb;

create index if not exists transcript_user_symbol_idx
  on public.transcript_analyses (user_id, symbol, generated_at desc);
