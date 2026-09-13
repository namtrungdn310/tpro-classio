-- Operator-approved repair for an orphaned historical M051 backup only.
-- Keep every snapshot and its ACL/RLS; do not finalize or re-run migration 051.
-- Take a full backup first. This is NOT part of the normal migration chain.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
lock table public.classes in share mode;
lock table public._migration_051_class_schedule_backup in access exclusive mode;

do $$
declare
  before_rows text;
  after_rows text;
  fk record;
  orphan_count bigint;
begin
  select md5(coalesce(string_agg(to_jsonb(b)::text, '' order by class_id), ''))
    into before_rows from public._migration_051_class_schedule_backup b;
  select * into fk from pg_constraint
    where conrelid = 'public._migration_051_class_schedule_backup'::regclass
      and conname = '_migration_051_class_schedule_backup_class_id_fkey';
  if found then
    if fk.contype <> 'f' or fk.confrelid <> 'public.classes'::regclass
       or fk.conkey <> array[(select attnum from pg_attribute
          where attrelid = fk.conrelid and attname = 'class_id')]::smallint[]
       or fk.confkey <> array[(select attnum from pg_attribute
          where attrelid = fk.confrelid and attname = 'id')]::smallint[] then
      raise exception 'Unexpected legacy constraint definition; no repair performed';
    end if;
    select count(*) into orphan_count
      from public._migration_051_class_schedule_backup b
      where not exists (select 1 from public.classes c where c.id = b.class_id);
    if orphan_count = 0 then
      raise exception 'No orphaned history found; keep the existing constraint';
    end if;
    alter table public._migration_051_class_schedule_backup
      drop constraint _migration_051_class_schedule_backup_class_id_fkey;
  end if;
  select md5(coalesce(string_agg(to_jsonb(b)::text, '' order by class_id), ''))
    into after_rows from public._migration_051_class_schedule_backup b;
  if before_rows is distinct from after_rows then
    raise exception 'Historical snapshots changed; rolling back';
  end if;
end $$;
commit;
