-- Run only in an empty disposable database, as postgres, with ON_ERROR_STOP=1.
create table public.classes (id uuid primary key);
create table public._migration_051_class_schedule_backup (
  class_id uuid primary key references public.classes(id) on delete restrict,
  schedule_before jsonb not null
);
alter table public._migration_051_class_schedule_backup enable row level security;
alter table public._migration_051_class_schedule_backup force row level security;
-- Reproduce existing validated-FK orphan state without modifying real data.
set session_replication_role = replica;
insert into public._migration_051_class_schedule_backup
  select md5(n::text)::uuid, jsonb_build_object('snapshot', n)
  from generate_series(1, 13) n;
set session_replication_role = origin;
create temporary table expected_backup as
  select * from public._migration_051_class_schedule_backup;

\ir ../../supabase/scripts/051_preserve_orphaned_backup.sql
\ir ../../supabase/scripts/051_preserve_orphaned_backup.sql

do $$
begin
  if exists (select * from expected_backup except select * from public._migration_051_class_schedule_backup)
    or exists (select * from public._migration_051_class_schedule_backup except select * from expected_backup)
    or (select count(*) from public._migration_051_class_schedule_backup) <> 13 then
    raise exception 'Snapshots were changed';
  end if;
  if exists (select 1 from pg_constraint
    where conrelid = 'public._migration_051_class_schedule_backup'::regclass and contype = 'f') then
    raise exception 'Orphaned backup FK remains';
  end if;
  if not (select relrowsecurity and relforcerowsecurity from pg_class
    where oid = 'public._migration_051_class_schedule_backup'::regclass) then
    raise exception 'Backup RLS changed';
  end if;
end $$;
select 'PASS: snapshots preserved, repair idempotent, RLS unchanged' as result;
