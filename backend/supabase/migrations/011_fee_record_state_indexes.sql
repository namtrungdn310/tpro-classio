-- Extra indexes for fee-state views and monthly fee dashboards
-- Speeds up filters by period + paid/unpaid/notified state

create index if not exists idx_fee_records_period_status_notified
  on fee_records (period, status, notified_at);
