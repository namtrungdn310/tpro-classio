-- Allow one class to have multiple teachers.
-- The legacy classes.teacher_id column stays as the first teacher for backward compatibility.

create table if not exists class_teachers (
  class_id uuid not null references classes(id) on delete cascade,
  teacher_id uuid not null references staff_members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (class_id, teacher_id)
);

create index if not exists idx_class_teachers_teacher_id
  on class_teachers (teacher_id);
  
insert into class_teachers (class_id, teacher_id)
select c.id, c.teacher_id
from classes c
join staff_members s
  on s.id = c.teacher_id
where c.teacher_id is not null
  and s.staff_type = 'TEACHER'
on conflict (class_id, teacher_id) do nothing;

alter table class_teachers enable row level security;

drop policy if exists "class_teachers_select" on class_teachers;
create policy "class_teachers_select"
on class_teachers for select
to authenticated
using (true);

drop policy if exists "class_teachers_write_admin" on class_teachers;
create policy "class_teachers_write_admin"
on class_teachers for all
to authenticated
using (is_admin())
with check (is_admin());
