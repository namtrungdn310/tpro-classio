-- R6-D02 assert-after: exact division removed; min-end + shape rules remain.
\set ON_ERROR_STOP on

do $$
declare
  backup_count integer;
  probe_end date;
begin
  if exists (
    select 1 from pg_trigger where tgname = 'classes_enforce_package_cycle_integrity'
  ) then
    raise exception 'T-DB054-003: package-cycle trigger still present after migration';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'classes_date_range_check'
       and conrelid = 'public.classes'::regclass
  ) then
    raise exception 'T-DB054-004: end >= start constraint missing';
  end if;

  if not exists (
    select 1 from pg_constraint
     where conname = 'classes_type_billing_cycle_check'
       and conrelid = 'public.classes'::regclass
  ) then
    raise exception 'T-DB054-005: cadence shape constraint missing';
  end if;

  -- Non-divisible course duration is now accepted (>= minimum).
  if not exists (
    select 1 from public.classes
     where id = '30000000-0000-0000-0000-0000000000b2'
  ) then
    insert into public.classes (
      id, name, type, base_fee, billing_cycle_months, billing_cycle_weeks,
      identity_scheme, is_active, start_date, end_date
    ) values (
      '30000000-0000-0000-0000-0000000000b2', 'M054 AFTER', 'COURSE', 750000, 1, 3,
      'LEGACY', true, date '2026-08-13', date '2026-09-10'
    );
  end if;

  select end_date into probe_end
    from public.classes
   where id = '30000000-0000-0000-0000-0000000000b2';

  if probe_end <> date '2026-09-10' then
    raise exception 'T-DB054-006: non-divisible duration was not persisted';
  end if;

  -- Backup evidence exists and is immutable per run_id.
  select count(*) into backup_count
    from public._migration_054_class_date_backup
   where run_id = 'M054-R6';
  if backup_count < 1 then
    raise exception 'T-DB054-007: backup evidence missing';
  end if;
end;
$$;
