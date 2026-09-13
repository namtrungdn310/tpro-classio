-- Cross-period collections queue used by GET /fees/outstanding.
-- Keep the index partial: paid/void history remains auditable but never needs
-- to participate in the operational unpaid scan. Do not use CONCURRENTLY here:
-- Supabase SQL Editor and the project migration runner execute this file in a
-- transaction, while PostgreSQL forbids CREATE INDEX CONCURRENTLY there.
create index if not exists ix_fee_records_outstanding_due
  on public.fee_records (
    (coalesce(adjusted_due_date, due_date)),
    period,
    enrollment_id,
    id
  )
  where status = 'UNPAID';

do $$
begin
  if to_regclass('public.ix_fee_records_outstanding_due') is null then
    raise exception '102 acceptance failed: outstanding fee queue index is missing';
  end if;
end $$;
