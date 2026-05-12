-- Phase 2a — allow the user's own session to insert into claude_usage.
-- (Postgres doesn't support CREATE POLICY IF NOT EXISTS, so drop first.)

drop policy if exists claude_usage_ins on public.claude_usage;
create policy claude_usage_ins on public.claude_usage
  for insert with check (auth.uid() = user_id);

drop policy if exists claude_usage_del on public.claude_usage;
create policy claude_usage_del on public.claude_usage
  for delete using (auth.uid() = user_id);
