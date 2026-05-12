-- Phase 2a — trade_ideas originally only had SELECT/INSERT/DELETE policies.
-- The new tracking feature needs UPDATE (mark as tracked / closed). Without
-- this, RLS silently blocks the update and the API returns 200 with zero rows
-- affected, which is what was happening when the user clicked Track.

drop policy if exists trade_ideas_upd on public.trade_ideas;
create policy trade_ideas_upd on public.trade_ideas
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
