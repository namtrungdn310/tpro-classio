-- Restore returning students without duplicating operational profiles while
-- keeping lifecycle changes auditable and personal data out of the audit log.

begin;

create index if not exists idx_students_identity_status_birth_date
  on public.students (birth_date, status, id)
  where birth_date is not null;

create index if not exists idx_students_identity_parent_phone
  on public.students (
    (regexp_replace(coalesce(parent_phone, ''), '\D', '', 'g')),
    status,
    id
  )
  where parent_phone is not null and btrim(parent_phone) <> '';

create index if not exists idx_students_identity_student_phone
  on public.students (
    (regexp_replace(coalesce(student_phone, ''), '\D', '', 'g')),
    status,
    id
  )
  where student_phone is not null and btrim(student_phone) <> '';

create table if not exists public.student_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null
    references public.students(id) on delete restrict,
  class_id uuid
    references public.classes(id) on delete restrict,
  enrollment_id uuid
    references public.enrollments(id) on delete restrict,
  actor_user_id uuid
    references public.profiles(id) on delete set null,
  action text not null check (action in (
    'student_deactivated',
    'student_reactivated',
    'existing_student_enrolled',
    'duplicate_candidate_overridden'
  )),
  previous_status text check (
    previous_status is null or previous_status in ('active', 'inactive')
  ),
  next_status text check (
    next_status is null or next_status in ('active', 'inactive')
  ),
  occurred_at timestamptz not null default now()
);

create index if not exists idx_student_lifecycle_events_student_time
  on public.student_lifecycle_events (student_id, occurred_at desc);

create index if not exists idx_student_lifecycle_events_actor_time
  on public.student_lifecycle_events (actor_user_id, occurred_at desc)
  where actor_user_id is not null;

create or replace function public.block_student_lifecycle_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'student lifecycle audit is append-only'
    using errcode = '42501';
end;
$$;

revoke all on function public.block_student_lifecycle_event_mutation()
  from public, anon, authenticated;

drop trigger if exists trg_student_lifecycle_events_append_only
  on public.student_lifecycle_events;
create trigger trg_student_lifecycle_events_append_only
before update or delete on public.student_lifecycle_events
for each row execute function public.block_student_lifecycle_event_mutation();

drop trigger if exists trg_student_lifecycle_events_truncate
  on public.student_lifecycle_events;
create trigger trg_student_lifecycle_events_truncate
before truncate on public.student_lifecycle_events
for each statement execute function public.block_student_lifecycle_event_mutation();

alter table public.student_lifecycle_events enable row level security;
alter table public.student_lifecycle_events force row level security;

revoke all privileges on table public.student_lifecycle_events
  from public, anon, authenticated;

commit;
