-- Reproduce the trigger shape from the originally released migration 036.
-- Migration 038 must repair this state without rewriting financial data.

create or replace function public.block_fee_operation_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'fee operation ledger is append-only'
    using errcode = '42501';
end;
$$;

drop trigger if exists trg_fee_operations_append_only
  on public.fee_operations;
drop trigger if exists trg_fee_operations_truncate_append_only
  on public.fee_operations;
drop trigger if exists trg_fee_operation_items_append_only
  on public.fee_operation_items;
drop trigger if exists trg_fee_operation_items_truncate_append_only
  on public.fee_operation_items;

create trigger trg_fee_operations_append_only
before update or delete or truncate on public.fee_operations
for each statement execute function public.block_fee_operation_mutation();

create trigger trg_fee_operation_items_append_only
before update or delete or truncate on public.fee_operation_items
for each statement execute function public.block_fee_operation_mutation();
