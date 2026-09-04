-- Role-neutral staff profiles and contextual class/slot assignments.
-- Expand phase: legacy columns stay available for one frontend compatibility
-- window.  No historical attendance or earning row is rewritten.

begin;

set local lock_timeout = '10s';
set local statement_timeout = '120s';

-- A class/staff pair must have one unambiguous current role before the role is
-- promoted to the class membership row.  Never guess on production data.
do $$
begin
  if exists (
    select 1
      from public.class_schedule_slots slot
      join public.class_schedule_slot_staff slot_staff on slot_staff.slot_id = slot.id
     where slot.effective_until is null
     group by slot.class_id, slot_staff.staff_id
    having count(distinct slot_staff.role) > 1
  ) then
    raise exception '122 preflight failed: a staff member has multiple roles in the same class';
  end if;

  if exists (
    select 1
      from public.class_teachers member
      join public.classes class_row on class_row.id = member.class_id
      join public.staff_members staff on staff.id = member.teacher_id
     where member.workspace_id is distinct from class_row.workspace_id
        or member.workspace_id is distinct from staff.workspace_id
  ) then
    raise exception '122 preflight failed: cross-workspace class staff membership';
  end if;
end $$;

alter table public.class_teachers add column if not exists role text;

with current_slot_role as (
  select slot.class_id, slot_staff.staff_id, min(slot_staff.role) as role
    from public.class_schedule_slots slot
    join public.class_schedule_slot_staff slot_staff on slot_staff.slot_id = slot.id
   where slot.effective_until is null
   group by slot.class_id, slot_staff.staff_id
)
update public.class_teachers member
   set role = current_slot_role.role
  from current_slot_role
 where member.class_id = current_slot_role.class_id
   and member.teacher_id = current_slot_role.staff_id
   and member.role is null;

update public.class_teachers member
   set role = staff.staff_type
  from public.staff_members staff
 where staff.id = member.teacher_id
   and member.role is null;

do $$
begin
  if exists (select 1 from public.class_teachers where role is null) then
    raise exception '122 backfill failed: class assignment role cannot be proven';
  end if;
end $$;

alter table public.class_teachers alter column role set not null;
alter table public.class_teachers
  drop constraint if exists class_teachers_role_check;
alter table public.class_teachers
  add constraint class_teachers_role_check
  check (role in ('TEACHER', 'ASSISTANT')) not valid;
alter table public.class_teachers validate constraint class_teachers_role_check;

create index if not exists class_teachers_workspace_role_staff_idx
  on public.class_teachers (workspace_id, role, teacher_id, class_id);

-- Staff profiles become role-neutral.  Keep old values for compatibility and
-- rollback, but new rows may be NULL.
alter table public.staff_members
  drop constraint if exists staff_members_staff_type_check;
alter table public.staff_members alter column staff_type drop not null;
alter table public.staff_members
  add constraint staff_members_legacy_staff_type_check
  check (staff_type is null or staff_type in ('TEACHER', 'ASSISTANT')) not valid;
alter table public.staff_members validate constraint staff_members_legacy_staff_type_check;

-- Current projection must never contain the same staff twice under two roles.
alter table public.class_schedule_slot_staff
  drop constraint if exists class_schedule_slot_staff_unique;
create unique index if not exists class_schedule_slot_staff_slot_staff_uniq
  on public.class_schedule_slot_staff (slot_id, staff_id);

-- Effective-dated assignment truth.  The compact slot table remains the
-- current projection so the old frontend keeps working during rollout.
create table if not exists public.class_schedule_slot_staff_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  class_id uuid not null references public.classes(id) on delete restrict,
  slot_id uuid not null references public.class_schedule_slots(id) on delete restrict,
  staff_id uuid not null references public.staff_members(id) on delete restrict,
  role text not null check (role in ('TEACHER', 'ASSISTANT')),
  effective_from timestamptz not null,
  effective_until timestamptz,
  actor_user_id uuid references public.profiles(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  constraint class_schedule_slot_staff_revisions_range_check
    check (effective_until is null or effective_from < effective_until),
  constraint class_schedule_slot_staff_revisions_reason_check
    check (reason is null or char_length(trim(reason)) between 3 and 500)
);

create unique index if not exists class_schedule_slot_staff_revisions_open_uniq
  on public.class_schedule_slot_staff_revisions (slot_id, staff_id)
  where effective_until is null;
create index if not exists class_schedule_slot_staff_revisions_occurrence_idx
  on public.class_schedule_slot_staff_revisions
    (workspace_id, staff_id, effective_from, effective_until);
create index if not exists class_schedule_slot_staff_revisions_slot_idx
  on public.class_schedule_slot_staff_revisions
    (workspace_id, slot_id, effective_from, effective_until);

insert into public.class_schedule_slot_staff_revisions (
  workspace_id, class_id, slot_id, staff_id, role,
  effective_from, effective_until, reason
)
select slot.workspace_id,
       slot.class_id,
       slot.id,
       slot_staff.staff_id,
       slot_staff.role,
       slot.effective_from::timestamp at time zone 'Asia/Ho_Chi_Minh',
       case when slot.effective_until is null then null
            else slot.effective_until::timestamp at time zone 'Asia/Ho_Chi_Minh'
       end,
       'Backfill phân công từ dữ liệu lịch hiện tại'
  from public.class_schedule_slots slot
  join public.class_schedule_slot_staff slot_staff on slot_staff.slot_id = slot.id
 where not exists (
   select 1
     from public.class_schedule_slot_staff_revisions revision
    where revision.slot_id = slot.id
      and revision.staff_id = slot_staff.staff_id
      and revision.effective_until is null
 );

-- A role-specific rate overrides the existing role-neutral default.  Existing
-- rate rows stay NULL and therefore retain exactly the old payroll behavior.
alter table public.staff_compensation_rates
  add column if not exists assignment_role text;
alter table public.staff_compensation_rates
  drop constraint if exists staff_compensation_rates_assignment_role_check;
alter table public.staff_compensation_rates
  add constraint staff_compensation_rates_assignment_role_check
  check (assignment_role is null or assignment_role in ('TEACHER', 'ASSISTANT')) not valid;
alter table public.staff_compensation_rates
  validate constraint staff_compensation_rates_assignment_role_check;

create index if not exists staff_compensation_rates_staff_role_effective_idx
  on public.staff_compensation_rates
    (workspace_id, staff_id, assignment_role, effective_from, effective_to);

create or replace function public.staff_compensation_rates_no_overlap()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if exists (
    select 1
      from public.staff_compensation_rates other
     where other.staff_id = new.staff_id
       and other.assignment_role is not distinct from new.assignment_role
       and other.id <> coalesce(new.id, '00000000-0000-0000-0000-000000000000'::uuid)
       and other.effective_from < coalesce(new.effective_to, 'infinity'::date)
       and coalesce(other.effective_to, 'infinity'::date) > new.effective_from
  ) then
    raise exception 'compensation rate ranges must not overlap for the same assignment role';
  end if;
  return new;
end;
$$;

-- Class membership validates the contextual role, not the deprecated global
-- staff role.
create or replace function public.validate_class_teacher_staff()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  staff_is_active boolean;
  legacy_staff_type text;
  class_is_active boolean;
  class_workspace uuid;
  staff_workspace uuid;
begin
  select class_.is_active, class_.workspace_id
    into class_is_active, class_workspace
    from public.classes class_
   where class_.id = new.class_id
   for no key update;

  select staff.is_active, staff.workspace_id, staff.staff_type
    into staff_is_active, staff_workspace, legacy_staff_type
    from public.staff_members staff
   where staff.id = new.teacher_id
   for no key update;

  -- Rolling-deploy bridge: the pre-122 backend did not send ``role``.  Old
  -- profiles still carry staff_type, so derive it inside the same write.
  if new.role is null then
    new.role := legacy_staff_type;
  end if;
  if new.role not in ('TEACHER', 'ASSISTANT') then
    raise exception 'class staff assignment role is invalid';
  end if;
  if class_workspace is distinct from staff_workspace then
    raise exception 'class staff assignment crosses workspace boundary';
  end if;
  if new.workspace_id is null then
    new.workspace_id := class_workspace;
  elsif new.workspace_id is distinct from class_workspace then
    raise exception 'class staff assignment crosses workspace boundary';
  end if;
  if class_is_active and not staff_is_active then
    raise exception 'active class member must be active';
  end if;
  return new;
end;
$$;

drop trigger if exists class_teachers_validate_staff on public.class_teachers;
create trigger class_teachers_validate_staff
before insert or update of class_id, teacher_id, role, workspace_id
on public.class_teachers
for each row execute function public.validate_class_teacher_staff();

create or replace function public.validate_class_slot_staff_assignment()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  slot_class_id uuid;
  slot_workspace uuid;
begin
  select slot.class_id, slot.workspace_id
    into slot_class_id, slot_workspace
    from public.class_schedule_slots slot
   where slot.id = new.slot_id;

  if new.workspace_id is null then
    new.workspace_id := slot_workspace;
  elsif new.workspace_id is distinct from slot_workspace then
    raise exception 'slot staff assignment crosses workspace boundary';
  end if;
  if not exists (
    select 1
      from public.class_teachers member
     where member.class_id = slot_class_id
       and member.teacher_id = new.staff_id
       and member.role = new.role
       and member.workspace_id = new.workspace_id
  ) then
    raise exception 'slot staff role does not match class staff assignment';
  end if;
  return new;
end;
$$;

drop trigger if exists class_schedule_slot_staff_validate_assignment
  on public.class_schedule_slot_staff;
create trigger class_schedule_slot_staff_validate_assignment
before insert or update of slot_id, staff_id, role, workspace_id
on public.class_schedule_slot_staff
for each row execute function public.validate_class_slot_staff_assignment();

-- Keep both current projections consistent at COMMIT while still allowing the
-- application to update membership first and slot rows second in one atomic
-- transaction.
create or replace function public.validate_class_staff_projection()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  target_class_id uuid;
  target_staff_id uuid;
begin
  if tg_op = 'DELETE' then
    target_class_id := old.class_id;
    target_staff_id := old.teacher_id;
  else
    target_class_id := new.class_id;
    target_staff_id := new.teacher_id;
  end if;
  if exists (
    select 1
      from public.class_schedule_slots slot
      join public.class_schedule_slot_staff slot_staff on slot_staff.slot_id = slot.id
     where slot.class_id = target_class_id
       and slot_staff.staff_id = target_staff_id
       and not exists (
         select 1
           from public.class_teachers member
          where member.class_id = target_class_id
            and member.teacher_id = target_staff_id
            and member.role = slot_staff.role
            and member.workspace_id = slot_staff.workspace_id
       )
  ) then
    raise exception 'slot staff projection does not match class staff assignment';
  end if;
  return null;
end;
$$;

drop trigger if exists class_teachers_validate_projection
  on public.class_teachers;
create constraint trigger class_teachers_validate_projection
after insert or update or delete on public.class_teachers
deferrable initially deferred
for each row execute function public.validate_class_staff_projection();

create or replace function public.validate_class_slot_staff_revision()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  slot_class_id uuid;
  slot_workspace uuid;
  staff_workspace uuid;
begin
  select slot.class_id, slot.workspace_id
    into slot_class_id, slot_workspace
    from public.class_schedule_slots slot
   where slot.id = new.slot_id;
  select staff.workspace_id
    into staff_workspace
    from public.staff_members staff
   where staff.id = new.staff_id;

  if slot_class_id is null or staff_workspace is null then
    raise exception 'staff assignment revision references missing data';
  end if;
  if new.class_id is distinct from slot_class_id
     or slot_workspace is distinct from staff_workspace then
    raise exception 'staff assignment revision crosses its class or workspace boundary';
  end if;
  if new.workspace_id is null then
    new.workspace_id := slot_workspace;
  elsif new.workspace_id is distinct from slot_workspace then
    raise exception 'staff assignment revision crosses its class or workspace boundary';
  end if;
  return new;
end;
$$;

drop trigger if exists class_schedule_slot_staff_revisions_validate
  on public.class_schedule_slot_staff_revisions;
create trigger class_schedule_slot_staff_revisions_validate
before insert or update of workspace_id, class_id, slot_id, staff_id, role,
  effective_from, effective_until
on public.class_schedule_slot_staff_revisions
for each row execute function public.validate_class_slot_staff_revision();

-- Global role changes are no longer meaningful.  Deactivation still protects
-- every operational class assignment regardless of contextual role.
create or replace function public.enforce_staff_assignment_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare target_id uuid := coalesce(new.id, old.id);
begin
  if tg_op = 'DELETE' then
    raise exception 'staff records must be archived instead of deleted';
  end if;
  if old.is_active and not new.is_active and exists (
    select 1
      from public.class_teachers member
      join public.classes class_ on class_.id = member.class_id
     where member.teacher_id = target_id
       and class_.is_active
       and class_.cancelled_at is null
       and class_.stopped_at is null
  ) then
    raise exception 'assigned staff on an active class cannot be deactivated';
  end if;
  return new;
end;
$$;

drop trigger if exists staff_members_assignment_lifecycle on public.staff_members;
create trigger staff_members_assignment_lifecycle
before update of is_active or delete on public.staff_members
for each row execute function public.enforce_staff_assignment_lifecycle();

-- The legacy primary-teacher column is only a projection.  It may reference a
-- role-neutral staff row as long as the person is active.
create or replace function public.validate_legacy_class_teacher_staff()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare staff_is_active boolean;
begin
  if new.teacher_id is not null then
    select staff.is_active into staff_is_active
      from public.staff_members staff
     where staff.id = new.teacher_id
     for no key update;
    if new.is_active and not staff_is_active then
      raise exception 'active class teacher must be active';
    end if;
  end if;
  if new.is_active then
    perform staff.id
      from public.class_teachers member
      join public.staff_members staff on staff.id = member.teacher_id
     where member.class_id = new.id
     for no key update of staff;
    if exists (
      select 1
        from public.class_teachers member
        join public.staff_members staff on staff.id = member.teacher_id
       where member.class_id = new.id
         and not staff.is_active
    ) then
      raise exception 'active class contains an inactive teacher or assistant';
    end if;
  end if;
  return new;
end;
$$;

-- Workspace boundary for the new table.
drop trigger if exists class_schedule_slot_staff_revisions_workspace_stamp
  on public.class_schedule_slot_staff_revisions;
create trigger class_schedule_slot_staff_revisions_workspace_stamp
before insert or update on public.class_schedule_slot_staff_revisions
for each row execute function public.stamp_workspace_id();

alter table public.class_schedule_slot_staff_revisions enable row level security;
alter table public.class_schedule_slot_staff_revisions force row level security;
revoke all on table public.class_schedule_slot_staff_revisions
  from public, anon, authenticated;

do $$
declare runtime_role name;
begin
  for runtime_role in
    select rolname from pg_roles where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    execute format(
      'grant select, insert, update, delete on table public.class_schedule_slot_staff_revisions to %I',
      runtime_role
    );
  end loop;
  if exists (select 1 from pg_roles where rolname = 'tpro_runtime') then
    drop policy if exists class_schedule_slot_staff_revisions_workspace_boundary
      on public.class_schedule_slot_staff_revisions;
    create policy class_schedule_slot_staff_revisions_workspace_boundary
      on public.class_schedule_slot_staff_revisions for all to tpro_runtime
      using (workspace_id = public.current_workspace_id())
      with check (workspace_id = public.current_workspace_id());
  end if;
end $$;

revoke all on function public.validate_class_teacher_staff()
  from public, anon, authenticated;
revoke all on function public.validate_class_slot_staff_assignment()
  from public, anon, authenticated;
revoke all on function public.validate_class_staff_projection()
  from public, anon, authenticated;
revoke all on function public.validate_class_slot_staff_revision()
  from public, anon, authenticated;
revoke all on function public.enforce_staff_assignment_lifecycle()
  from public, anon, authenticated;
revoke all on function public.validate_legacy_class_teacher_staff()
  from public, anon, authenticated;

create or replace function public.contextual_class_staff_version()
returns integer
language sql
stable
set search_path = pg_catalog
as $$ select 1 $$;
revoke all on function public.contextual_class_staff_version() from public;

do $$
declare runtime_role name;
begin
  for runtime_role in
    select rolname from pg_roles where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    execute format(
      'grant execute on function public.contextual_class_staff_version() to %I',
      runtime_role
    );
  end loop;
end $$;

commit;
