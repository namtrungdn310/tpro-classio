-- TPRO Classio — 074_suspension_window_invariants.sql
-- Forward-only hardening for whole-class postponement.
-- The application already uses the class row lock; this migration protects
-- direct/server-side writers and concurrent workers as well.

begin;

do $$
begin
  if exists (
    select 1 from public.class_schedule_adjustments
    where affected_through < affected_from
       or (affected_through - affected_from) > 119
  ) then
    raise exception 'M074 preflight failed: invalid or overlong suspension window';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
      from public.enrollments e
      join public.class_schedule_adjustments a
        on a.class_id = e.class_id
       and a.status = 'OPEN'
       and a.affected_from <= e.enrollment_date
       and a.affected_through >= e.enrollment_date
     where e.status = 'active'
  ) then
    raise exception 'M074 preflight failed: active enrollment starts inside an open suspension';
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.class_schedule_adjustments'::regclass
      and conname = 'class_schedule_adjustments_max_window_check'
  ) then
    alter table public.class_schedule_adjustments
      add constraint class_schedule_adjustments_max_window_check
      check ((affected_through - affected_from) between 0 and 119);
  end if;
end $$;

create index if not exists idx_class_schedule_adjustments_open_window
  on public.class_schedule_adjustments (class_id, affected_from, affected_through)
  where status = 'OPEN';

create or replace function public.block_overlapping_open_suspension()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  conflict_id uuid;
begin
  -- Serialize writers for one class before checking its half-open date range.
  perform pg_advisory_xact_lock(hashtextextended('class-suspension:' || new.class_id::text, 0));
  if new.status = 'OPEN' then
    select id into conflict_id
      from public.class_schedule_adjustments
     where class_id = new.class_id
       and status = 'OPEN'
       and id <> new.id
       and affected_from <= new.affected_through
       and affected_through >= new.affected_from
     order by created_at desc, id desc
     limit 1;
    if conflict_id is not null then
      raise exception 'open suspension windows overlap for class %', new.class_id
        using errcode = '23P01';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.block_overlapping_open_suspension() from public, anon, authenticated;

drop trigger if exists trg_class_schedule_adjustments_no_overlap
  on public.class_schedule_adjustments;
create trigger trg_class_schedule_adjustments_no_overlap
before insert or update of class_id, affected_from, affected_through, status
on public.class_schedule_adjustments
for each row execute function public.block_overlapping_open_suspension();

create or replace function public.block_enrollment_during_open_suspension()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
begin
  if new.status = 'active' and new.enrollment_date is not null then
    if exists (
      select 1
        from public.class_schedule_adjustments a
       where a.class_id = new.class_id
         and a.status = 'OPEN'
         and a.affected_from <= new.enrollment_date
         and a.affected_through >= new.enrollment_date
    ) then
      raise exception 'cannot enroll a student while the class is suspended'
        using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.block_enrollment_during_open_suspension()
  from public, anon, authenticated;

drop trigger if exists trg_enrollments_no_open_suspension on public.enrollments;
create trigger trg_enrollments_no_open_suspension
before insert or update of class_id, enrollment_date, status
on public.enrollments
for each row execute function public.block_enrollment_during_open_suspension();

commit;
