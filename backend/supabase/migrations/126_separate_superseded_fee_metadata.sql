-- Replacement is not cancellation. Preserve legacy audit rows unchanged.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table public.fee_records
  drop constraint if exists fee_records_void_metadata_check;
alter table public.fee_records
  add constraint fee_records_void_metadata_check check (
    (status <> 'VOID' or voided_at is not null)
    and (status <> 'SUPERSEDED' or superseded_at is not null or voided_at is not null)
  ) not valid;
-- Legacy SUPERSEDED rows may have only voided_at. Do not rewrite their audit.
-- New billing commands set superseded_at only; VOID still requires voided_at.
alter table public.fee_records validate constraint fee_records_void_metadata_check;
commit;
