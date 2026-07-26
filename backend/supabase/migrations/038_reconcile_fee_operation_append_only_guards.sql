-- Migration 036 existed in more than one committed form. Reconcile every
-- already-applied variant forward instead of relying on edited migration
-- history. This migration is intentionally idempotent and data-preserving.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

create or replace function public.block_fee_operation_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    -- Preserve immutable actor snapshots while allowing the profile foreign
    -- key's ON DELETE SET NULL action during account deletion.
    if tg_op = 'UPDATE'
        and new.id is not distinct from old.id
        and new.sequence_no is not distinct from old.sequence_no
        and new.action is not distinct from old.action
        and new.origin is not distinct from old.origin
        and new.request_id is not distinct from old.request_id
        and new.period is not distinct from old.period
        and new.business_date is not distinct from old.business_date
        and new.occurred_at is not distinct from old.occurred_at
        and new.actor_name_snapshot is not distinct from old.actor_name_snapshot
        and new.actor_username_snapshot is not distinct from old.actor_username_snapshot
        and new.actor_role_snapshot is not distinct from old.actor_role_snapshot
        and new.item_count is not distinct from old.item_count
        and new.total_amount is not distinct from old.total_amount
        and new.schema_version is not distinct from old.schema_version
        and (
            new.actor_user_id is not distinct from old.actor_user_id
            or (old.actor_user_id is not null and new.actor_user_id is null)
        )
    then
        return new;
    end if;

    raise exception 'fee operation ledger is append-only'
        using errcode = '42501';
end;
$$;

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

revoke execute on function public.block_fee_operation_mutation()
    from public, anon, authenticated;
revoke execute on function public.block_fee_operation_item_mutation()
    from public, anon, authenticated;

drop trigger if exists trg_fee_operations_append_only
    on public.fee_operations;
create trigger trg_fee_operations_append_only
before update or delete on public.fee_operations
for each row execute function public.block_fee_operation_mutation();

drop trigger if exists trg_fee_operations_truncate_append_only
    on public.fee_operations;
create trigger trg_fee_operations_truncate_append_only
before truncate on public.fee_operations
for each statement execute function public.block_fee_operation_mutation();

drop trigger if exists trg_fee_operation_items_append_only
    on public.fee_operation_items;
create trigger trg_fee_operation_items_append_only
before update or delete on public.fee_operation_items
for each row execute function public.block_fee_operation_item_mutation();

drop trigger if exists trg_fee_operation_items_truncate_append_only
    on public.fee_operation_items;
create trigger trg_fee_operation_items_truncate_append_only
before truncate on public.fee_operation_items
for each statement execute function public.block_fee_operation_item_mutation();

commit;
