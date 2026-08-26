-- A new teaching period is a new class.  Persist the immediate predecessor
-- and an idempotency key so the old class, enrollments and financial history
-- never need to be rewritten when a cohort continues.
begin;

alter table public.classes
  add column if not exists previous_class_id uuid,
  add column if not exists continuation_request_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.classes'::regclass
      and conname = 'classes_previous_class_not_self_check'
  ) then
    alter table public.classes
      add constraint classes_previous_class_not_self_check
      check (previous_class_id is null or previous_class_id <> id);
  end if;
end $$;

-- The composite key makes the lineage boundary enforceable in PostgreSQL,
-- including for writes that do not pass through the application ORM.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.classes'::regclass
      and conname = 'classes_workspace_id_id_unique'
  ) then
    alter table public.classes
      add constraint classes_workspace_id_id_unique unique (workspace_id, id);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.classes'::regclass
      and conname = 'classes_previous_class_workspace_fkey'
  ) then
    alter table public.classes
      add constraint classes_previous_class_workspace_fkey
      foreign key (workspace_id, previous_class_id)
      references public.classes (workspace_id, id)
      on delete restrict;
  end if;
end $$;

create index if not exists ix_classes_previous_class
  on public.classes (workspace_id, previous_class_id)
  where previous_class_id is not null;

create unique index if not exists ux_classes_continuation_request
  on public.classes (workspace_id, continuation_request_id)
  where continuation_request_id is not null;

do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'classes'
       and column_name in ('previous_class_id', 'continuation_request_id')
     group by table_schema, table_name
    having count(*) = 2
  ) then
    raise exception '112 acceptance failed: class continuation columns are missing';
  end if;
  if to_regclass('public.ux_classes_continuation_request') is null then
    raise exception '112 acceptance failed: continuation idempotency index is missing';
  end if;
end $$;

commit;
