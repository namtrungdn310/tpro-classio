-- R7 closeout — keep the fee-operation ledger immutable while allowing the
-- actor FK's ON DELETE SET NULL action when an account is permanently removed.
--
-- Migration 038 compared a fixed list of columns. That list is brittle as the
-- ledger evolves and caused valid FK anonymization to be rejected. Compare the
-- complete row shape instead, excluding only actor_user_id.

begin;

do $$
begin
  if to_regclass('public.fee_operations') is null then
    raise exception '072 preflight abort: public.fee_operations is missing';
  end if;
  if to_regprocedure('public.block_fee_operation_mutation()') is null then
    raise exception '072 preflight abort: fee operation guard is missing';
  end if;
end;
$$;

create or replace function public.block_fee_operation_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if tg_op = 'UPDATE'
     and old.actor_user_id is not null
     and new.actor_user_id is null
     and (to_jsonb(new) - 'actor_user_id') = (to_jsonb(old) - 'actor_user_id')
  then
    return new;
  end if;

  raise exception 'fee operation ledger is append-only'
    using errcode = '42501';
end;
$$;

revoke all on function public.block_fee_operation_mutation()
  from public, anon, authenticated;

do $$
begin
  if position(
    'to_jsonb(new) - ''actor_user_id'''
    in pg_get_functiondef('public.block_fee_operation_mutation()'::regprocedure)
  ) = 0 then
    raise exception '072 acceptance failed: actor anonymization guard is stale';
  end if;
end;
$$;

commit;
