-- Exact week-based package billing and package-boundary lifecycle integrity.
-- Forward-only: apply after 045. Existing course rows keep their former
-- month-derived duration as an explicit week value; new writes use weeks only.

begin;

alter table public.classes
  add column if not exists billing_cycle_weeks smallint;

update public.classes
set billing_cycle_weeks = greatest(billing_cycle_months, 1) * 4
where type = 'COURSE' and billing_cycle_weeks is null;

alter table public.fee_records
  add column if not exists billing_cycle_weeks_snapshot smallint;

update public.fee_records
set billing_cycle_weeks_snapshot = greatest(billing_cycle_months_snapshot, 1) * 4
where class_type_snapshot = 'COURSE'
  and billing_cycle_weeks_snapshot is null
  and billing_cycle_months_snapshot is not null;

alter table public.classes
  drop constraint if exists classes_type_billing_cycle_check,
  drop constraint if exists classes_billing_cycle_weeks_check,
  add constraint classes_billing_cycle_weeks_check
    check (billing_cycle_weeks is null or billing_cycle_weeks >= 1),
  add constraint classes_type_billing_cycle_check
    check (
      (type = 'MONTHLY' and billing_cycle_months = 1 and billing_cycle_weeks is null)
      or (type = 'COURSE' and billing_cycle_weeks >= 1)
    ) not valid;

alter table public.fee_records
  drop constraint if exists fee_records_billing_cycle_weeks_snapshot_check,
  add constraint fee_records_billing_cycle_weeks_snapshot_check
    check (
      billing_cycle_weeks_snapshot is null
      or billing_cycle_weeks_snapshot >= 1
    ) not valid;

create or replace function public.enforce_class_package_cycle_integrity()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  cycle_days integer;
begin
  if new.type::text = 'MONTHLY' then
    new.billing_cycle_months := 1;
    new.billing_cycle_weeks := null;
    return new;
  end if;

  if new.billing_cycle_weeks is null or new.billing_cycle_weeks < 1 then
    raise exception 'course billing_cycle_weeks must be at least one';
  end if;

  if new.start_date is not null and new.end_date is not null then
    cycle_days := new.billing_cycle_weeks::integer * 7;
    if mod(new.end_date - new.start_date, cycle_days) <> 0 then
      raise exception 'class date range must contain complete billing packages';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_class_package_cycle_integrity()
  from public, anon, authenticated;

drop trigger if exists classes_enforce_package_cycle_integrity on public.classes;
create trigger classes_enforce_package_cycle_integrity
before insert or update of type, billing_cycle_months, billing_cycle_weeks, start_date, end_date
on public.classes
for each row execute function public.enforce_class_package_cycle_integrity();

create or replace function public.enforce_enrollment_class_date_range()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  class_start date;
  class_end date;
  class_scheme text;
  class_type text;
  class_cycle_weeks integer;
  cycle_days integer;
begin
  if new.status::text <> 'active' then
    return new;
  end if;

  select
    c.start_date,
    c.end_date,
    c.identity_scheme::text,
    c.type::text,
    c.billing_cycle_weeks
  into class_start, class_end, class_scheme, class_type, class_cycle_weeks
  from public.classes c
  where c.id = new.class_id;

  if class_scheme <> 'LEGACY' then
    if new.enrollment_date is null then
      raise exception 'active enrollment_date is required';
    end if;
    if new.enrollment_date < class_start or new.enrollment_date >= class_end then
      raise exception 'enrollment_date must be within the class enrollment range';
    end if;
    if class_type = 'COURSE' then
      if class_cycle_weeks is null or class_cycle_weeks < 1 then
        raise exception 'course billing_cycle_weeks is invalid';
      end if;
      cycle_days := class_cycle_weeks * 7;
      if mod(new.enrollment_date - class_start, cycle_days) <> 0 then
        raise exception 'enrollment_date must start on a package boundary';
      end if;
      if new.enrollment_date + cycle_days > class_end then
        raise exception 'enrollment must contain at least one complete package';
      end if;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.enforce_enrollment_class_date_range()
  from public, anon, authenticated;

commit;
