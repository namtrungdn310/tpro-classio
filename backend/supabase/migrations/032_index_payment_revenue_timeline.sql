-- Dashboard cash-flow history filters the append-only ledger by business date.
-- This index keeps the six-month overview bounded as the ledger grows.
create index if not exists idx_payments_payment_date
  on public.payments (payment_date)
  include (amount);
