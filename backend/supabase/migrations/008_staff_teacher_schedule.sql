-- Staff roster and teacher-aware class schedules.
-- Staff fixtures and class assignments live under supabase/seeds; this
-- migration only changes schema and never replaces production staff data.

begin;

create table if not exists staff_members (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  staff_type text not null,
  email text,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint staff_members_staff_type_check check (staff_type in ('TEACHER', 'ASSISTANT'))
);

create unique index if not exists ux_staff_members_email
  on staff_members (lower(email))
  where email is not null;

create index if not exists idx_staff_members_type_active
  on staff_members (staff_type, is_active);

do $$
begin
  if not exists (
    select 1
    from information_schema.columns
    where table_name = 'classes'
      and column_name = 'teacher_id'
  ) then
    alter table classes
      add column teacher_id uuid references staff_members(id) on delete set null;
  end if;
end $$;

create index if not exists idx_classes_teacher_id
  on classes (teacher_id);

drop trigger if exists staff_members_updated_at on staff_members;
create trigger staff_members_updated_at
before update on staff_members
for each row execute function set_updated_at();

alter table staff_members enable row level security;

drop policy if exists "staff_members_select" on staff_members;
create policy "staff_members_select"
on staff_members for select
using (auth.uid() is not null);

drop policy if exists "staff_members_write_admin" on staff_members;
create policy "staff_members_write_admin"
on staff_members for all
using (is_admin())
with check (is_admin());

alter table classes
  drop constraint if exists classes_teacher_id_fkey;

alter table classes
  add constraint classes_teacher_id_fkey
  foreign key (teacher_id)
  references staff_members(id)
  on delete set null;

commit;
