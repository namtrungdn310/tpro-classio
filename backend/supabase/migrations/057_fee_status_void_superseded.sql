-- R6-D06 — fee_status enum expand (VOID/SUPERSEDED).
--
-- Adding enum values requires its own transaction (PostgreSQL "unsafe use of
-- new enum value" rule): this migration ONLY adds values; constraint changes
-- that reference the new values live in the next migration file.

begin;

do $$
begin
  if not exists (
    select 1 from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'fee_status' and e.enumlabel = 'VOID'
  ) then
    alter type public.fee_status add value 'VOID';
  end if;
  if not exists (
    select 1 from pg_enum e
     join pg_type t on t.oid = e.enumtypid
    where t.typname = 'fee_status' and e.enumlabel = 'SUPERSEDED'
  ) then
    alter type public.fee_status add value 'SUPERSEDED';
  end if;
end;
$$;

commit;
