-- Phase 2 — sector ETF flow inference now uses Yahoo (AUM + price) and
-- computes net flow as AUM delta minus price-return-explained AUM change. We
-- store the spot price alongside AUM so we can decompose against a baseline
-- snapshot a week back.

alter table public.etf_flows
  add column if not exists price numeric,
  add column if not exists shares_outstanding numeric;
