-- Make fee-operation-item immutability intentional and deterministic.
-- Migration 036 reused the fee_operations row trigger as a statement trigger
-- on fee_operation_items. UPDATE therefore failed by accidentally reading
-- non-existent NEW/OLD fields instead of raising the documented ledger error.

begin;

-- Fail and retry instead of waiting indefinitely behind a long-running ledger
-- transaction during deployment. The whole migration remains atomic.
set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.block_fee_operation_item_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    raise exception 'fee operation item ledger is append-only'
        using errcode = '42501';
end;
$$;

revoke all on function public.block_fee_operation_item_mutation()
    from public, anon, authenticated;

drop trigger if exists trg_fee_operation_items_append_only
    on public.fee_operation_items;
drop trigger if exists trg_fee_operation_items_truncate_append_only
    on public.fee_operation_items;

create trigger trg_fee_operation_items_append_only
before update or delete on public.fee_operation_items
for each statement execute function public.block_fee_operation_item_mutation();

create trigger trg_fee_operation_items_truncate_append_only
before truncate on public.fee_operation_items
for each statement execute function public.block_fee_operation_item_mutation();

commit;
