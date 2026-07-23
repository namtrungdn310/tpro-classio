alter table fee_records
  add column if not exists notified_at timestamptz,
  add column if not exists notification_channel text,
  add column if not exists notification_message text;

create index if not exists idx_fee_records_notified_at
  on fee_records (notified_at);

create index if not exists idx_fee_records_period_status
  on fee_records (period, status);

create index if not exists idx_fee_records_period_notified_at
  on fee_records (period, notified_at);

create index if not exists idx_fee_records_enrollment_status_period
  on fee_records (enrollment_id, status, period);
