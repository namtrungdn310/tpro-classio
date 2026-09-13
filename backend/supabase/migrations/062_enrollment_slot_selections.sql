-- R6-D09 — Enrollment session selections (forward-only expand).
--
-- Contract: dev.md §5.2, test.md §6.2. Selections are effective-dated per
-- (enrollment, slot); they control occurrence/makeup/attendance eligibility
-- only — never fee amounts. Backfill: current active enrollments select ALL
-- active slots of their class.

begin;

-- ===========================================================================
-- 1. Tables
-- ===========================================================================
create table if not exists public.enrollment_slot_selections (
  id uuid primary key default gen_random_uuid(),
  enrollment_id uuid not null references public.enrollments(id) on delete restrict,
  slot_id uuid not null references public.class_schedule_slots(id) on delete restrict,
  effective_from date not null default '1970-01-01',
  effective_until date,
  version integer not null default 1,
  actor_user_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  constraint enrollment_slot_selections_range_check
    check (effective_from <= effective_until or effective_until is null),
  constraint enrollment_slot_selections_identity
    unique (enrollment_id, slot_id, effective_from)
);

drop index if exists enrollment_slot_selections_enrollment_idx;
create index enrollment_slot_selections_enrollment_idx
  on public.enrollment_slot_selections (enrollment_id, effective_from, effective_until);
drop index if exists enrollment_slot_selections_slot_idx;
create index enrollment_slot_selections_slot_idx
  on public.enrollment_slot_selections (slot_id, effective_from, effective_until);

-- Chống overlapping ranges cho cùng (enrollment, slot): trigger giữ half-open.
create or replace function public.enrollment_slot_selections_no_overlap()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if exists (
    select 1
      from public.enrollment_slot_selections other
     where other.enrollment_id = new.enrollment_id
       and other.slot_id = new.slot_id
       and other.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000')
       and other.effective_from < coalesce(new.effective_until, 'infinity'::date)
       and coalesce(other.effective_until, 'infinity'::date) > new.effective_from
  ) then
    raise exception 'overlapping slot selection ranges are not allowed';
  end if;
  return new;
end;
$$;

revoke all on function public.enrollment_slot_selections_no_overlap() from public, anon, authenticated;

drop trigger if exists trg_enrollment_slot_selections_no_overlap on public.enrollment_slot_selections;
create trigger trg_enrollment_slot_selections_no_overlap
before insert or update on public.enrollment_slot_selections
for each row execute function public.enrollment_slot_selections_no_overlap();

alter table public.enrollment_slot_selections enable row level security;
alter table public.enrollment_slot_selections force row level security;
revoke all on table public.enrollment_slot_selections from public, anon, authenticated;

-- ===========================================================================
-- 2. Backfill: active enrollments select ALL active slots of their class
-- ===========================================================================
do $$
declare
  r record;
  missing_class_slots bigint;
begin
  for r in
    select e.id as enrollment_id, s.id as slot_id
      from public.enrollments e
      join public.class_schedule_slots s on s.class_id = e.class_id
     where e.status = 'active'
       and s.effective_until is null
       and not exists (
         select 1 from public.enrollment_slot_selections sel
          where sel.enrollment_id = e.id
            and sel.slot_id = s.id
            and sel.effective_until is null
       )
     order by e.id, s.id
  loop
    insert into public.enrollment_slot_selections (enrollment_id, slot_id)
    values (r.enrollment_id, r.slot_id);
  end loop;

  -- Lớp không có canonical slots -> enrollments active bị thiếu selection:
  -- abort (cần manual mapping), không đoán.
  select count(*) into missing_class_slots
    from public.enrollments e
   where e.status = 'active'
     and not exists (
       select 1 from public.class_schedule_slots s
        where s.class_id = e.class_id and s.effective_until is null
     )
     and not exists (
       select 1 from public.enrollment_slot_selections sel
        where sel.enrollment_id = e.id
     );
  if missing_class_slots > 0 then
    raise exception 'M062 backfill abort: % active enrollment(s) without canonical slots; manual mapping required', missing_class_slots;
  end if;
  raise notice 'M062 backfill done';
end;
$$;

-- ===========================================================================
-- 3. Rerun + acceptance
-- ===========================================================================
do $$
declare
  active_enrollments bigint;
  selected_enrollments bigint;
begin
  select count(*) into active_enrollments
    from public.enrollments where status = 'active';
  select count(distinct enrollment_id) into selected_enrollments
    from public.enrollment_slot_selections
   where effective_until is null;
  if active_enrollments <> selected_enrollments then
    raise exception 'M062 acceptance failed: active enrollments (%) <> with active selection (%)',
      active_enrollments, selected_enrollments;
  end if;
  raise notice 'M062 acceptance OK: % active enrollments fully selected', selected_enrollments;
end;
$$;

commit;
