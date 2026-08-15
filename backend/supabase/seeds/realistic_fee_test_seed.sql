-- DEVELOPMENT ONLY: realistic test data for fee collection flows.
-- Never run this file on staging or production. It deletes and rebuilds all
-- business data while intentionally retaining auth.users and profiles.
--
-- This seed is intentionally opt-in. Before running it with psql, execute in
-- the same database session:
--   set app.tpro_destructive_seed_confirmation = 'RESET_LOCAL_DEMO_DATA';
-- The confirmation prevents an accidental paste into a shared environment.

begin;

do $$
declare
  tbl text;
  seed_tables text[] := array[
    'public.classes',
    'public.class_lifecycle_events',
    'public.class_teacher_events',
    'public.class_teachers',
    'public.student_lifecycle_events',
    'public.students',
    'public.enrollments',
    'public.fee_records',
    'public.payments',
    'public.fee_operations',
    'public.fee_operation_items',
    'public.staff_members'
  ];
begin
  if current_setting('app.tpro_destructive_seed_confirmation', true)
    is distinct from 'RESET_LOCAL_DEMO_DATA' then
    raise exception
      'Destructive development seed is blocked. Set app.tpro_destructive_seed_confirmation to RESET_LOCAL_DEMO_DATA in this session before running it.';
  end if;

  -- The production schema protects lifecycle/ledger history with many user
  -- triggers (append-only, package-cycle, enrollment-range, ...). A local
  -- fixture reset is the one explicit exception: disable every user trigger on
  -- the tables this seed touches and restore them right before commit.
  foreach tbl in array seed_tables loop
    if to_regclass(tbl) is not null then
      execute format('alter table %s disable trigger user', tbl);
    end if;
  end loop;

  if to_regclass('public.class_lifecycle_events') is not null then
    execute 'delete from public.class_lifecycle_events';
  end if;
  if to_regclass('public.class_teacher_events') is not null then
    execute 'delete from public.class_teacher_events';
  end if;
  if to_regclass('public.student_lifecycle_events') is not null then
    execute 'delete from public.student_lifecycle_events';
  end if;
  if to_regclass('public.class_teachers') is not null then
    execute 'delete from public.class_teachers';
  end if;
end
$$;

alter table fee_records
  add column if not exists notified_at timestamptz,
  add column if not exists notification_channel text,
  add column if not exists notification_message text;

delete from fee_operation_items;
delete from fee_operations;
delete from payments;
delete from fee_records;
delete from enrollments;
delete from students;
delete from classes;
delete from staff_members;

-- Giáo viên và trợ giảng dùng id cố định để seed có thể gán theo từng lớp/buổi.
insert into staff_members (
  id,
  full_name,
  staff_type,
  phone,
  zalo_name,
  is_active
) values
  ('00000000-0000-4000-8000-000000000001', 'Cô Thu Hà',   'TEACHER',  '0911000001', 'Cô Thu Hà',   true),
  ('00000000-0000-4000-8000-000000000002', 'Cô Mai Lan',  'TEACHER',  '0911000002', 'Cô Mai Lan',  true),
  ('00000000-0000-4000-8000-000000000003', 'Thầy Minh Đức','TEACHER',  '0911000003', 'Thầy Minh Đức', true),
  ('00000000-0000-4000-8000-000000000004', 'Cô Bích Ngọc','TEACHER',  '0911000004', 'Cô Bích Ngọc', true),
  ('00000000-0000-4000-8000-000000000005', 'Thầy Quang Huy','TEACHER', '0911000005', 'Thầy Quang Huy', true),
  ('00000000-0000-4000-8000-000000000006', 'Cô Thanh Trúc','TEACHER',  '0911000006', 'Cô Thanh Trúc', true),
  ('00000000-0000-4000-8000-000000000007', 'Thầy Đức Anh','TEACHER',  '0911000007', 'Thầy Đức Anh', true),
  ('00000000-0000-4000-8000-000000000008', 'Cô Phương Linh','TEACHER', '0911000008', 'Cô Phương Linh', true),
  ('00000000-0000-4000-8000-000000000009', 'Anh Hoàng Nam','ASSISTANT', '0911000009', 'Anh Hoàng Nam', true),
  ('00000000-0000-4000-8000-00000000000a', 'Chị Thảo Vy', 'ASSISTANT', '0911000010', 'Chị Thảo Vy', true),
  ('00000000-0000-4000-8000-00000000000b', 'Anh Tuấn Kiệt','ASSISTANT', '0911000011', 'Anh Tuấn Kiệt', true),
  ('00000000-0000-4000-8000-00000000000c', 'Chị Hồng Nhung','ASSISTANT','0911000012', 'Chị Hồng Nhung', true),
  ('00000000-0000-4000-8000-00000000000d', 'Cô Ngọc Diễm','TEACHER',  '0911000013', 'Cô Ngọc Diễm', false),
  ('00000000-0000-4000-8000-00000000000e', 'Anh Gia Bảo', 'ASSISTANT', '0911000014', 'Anh Gia Bảo', false);

insert into classes (
  name,
  type,
  base_fee,
  billing_cycle_months,
  start_date,
  schedule,
  is_active
) values
  (
    '6C1',
    'MONTHLY'::class_type,
    750000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 2 (13:30-15:00); Thứ 4 (13:30-15:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 2', 'start', '13:30', 'end', '15:00'),
        jsonb_build_object('day', 'Thứ 4', 'start', '13:30', 'end', '15:00')
      )
    ),
    true
  ),
  (
    '6C2',
    'MONTHLY'::class_type,
    750000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 3 (13:30-15:00); Thứ 5 (13:30-15:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 3', 'start', '13:30', 'end', '15:00'),
        jsonb_build_object('day', 'Thứ 5', 'start', '13:30', 'end', '15:00')
      )
    ),
    true
  ),
  (
    '6C3',
    'MONTHLY'::class_type,
    750000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 3 (15:00-16:30); Thứ 5 (15:00-16:30)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 3', 'start', '15:00', 'end', '16:30'),
        jsonb_build_object('day', 'Thứ 5', 'start', '15:00', 'end', '16:30')
      )
    ),
    true
  ),
  (
    '7C1',
    'MONTHLY'::class_type,
    800000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 2 (17:00-18:30); Thứ 4 (17:00-18:30)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 2', 'start', '17:00', 'end', '18:30'),
        jsonb_build_object('day', 'Thứ 4', 'start', '17:00', 'end', '18:30')
      )
    ),
    true
  ),
  (
    '7C2',
    'MONTHLY'::class_type,
    800000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 3 (17:00-18:30); Thứ 5 (17:00-18:30)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 3', 'start', '17:00', 'end', '18:30'),
        jsonb_build_object('day', 'Thứ 5', 'start', '17:00', 'end', '18:30')
      )
    ),
    true
  ),
  (
    '7C3',
    'MONTHLY'::class_type,
    800000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 4 (15:30-17:00); Thứ 6 (15:30-17:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 4', 'start', '15:30', 'end', '17:00'),
        jsonb_build_object('day', 'Thứ 6', 'start', '15:30', 'end', '17:00')
      )
    ),
    true
  ),
  (
    '7C4',
    'MONTHLY'::class_type,
    800000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 2 (15:30-17:00); Thứ 7 (10:00-11:30)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 2', 'start', '15:30', 'end', '17:00'),
        jsonb_build_object('day', 'Thứ 7', 'start', '10:00', 'end', '11:30')
      )
    ),
    true
  ),
  (
    'Kèm 9',
    'MONTHLY'::class_type,
    1200000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 3 (20:00-21:30); Thứ 6 (20:00-21:30)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 3', 'start', '20:00', 'end', '21:30'),
        jsonb_build_object('day', 'Thứ 6', 'start', '20:00', 'end', '21:30')
      )
    ),
    true
  ),
  (
    'L12',
    'MONTHLY'::class_type,
    1000000,
    1,
    current_date - interval '2 months',
    jsonb_build_object(
      'text', 'Thứ 2 (20:00-21:30); Thứ 4 (20:00-21:30)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 2', 'start', '20:00', 'end', '21:30'),
        jsonb_build_object('day', 'Thứ 4', 'start', '20:00', 'end', '21:30')
      )
    ),
    true
  ),
  (
    'IELTS 10',
    'COURSE'::class_type,
    4500000,
    3,
    current_date - interval '4 months',
    jsonb_build_object(
      'text', 'Thứ 4 (18:30-20:00); Thứ 6 (18:30-20:00); Thứ 7 (08:00-10:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 4', 'start', '18:30', 'end', '20:00'),
        jsonb_build_object('day', 'Thứ 6', 'start', '18:30', 'end', '20:00'),
        jsonb_build_object('day', 'Thứ 7', 'start', '08:00', 'end', '10:00')
      )
    ),
    true
  ),
  (
    'IELTS Tổng hợp',
    'COURSE'::class_type,
    8000000,
    6,
    current_date - interval '7 months',
    jsonb_build_object(
      'text', 'Thứ 3 (18:30-20:00); Thứ 5 (18:30-20:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 3', 'start', '18:30', 'end', '20:00'),
        jsonb_build_object('day', 'Thứ 5', 'start', '18:30', 'end', '20:00')
      )
    ),
    true
  ),
  (
    'IELTS Chuyên sâu',
    'COURSE'::class_type,
    13500000,
    12,
    current_date - interval '12 months',
    jsonb_build_object(
      'text', 'Thứ 2 (18:30-20:00); Thứ 5 (18:30-20:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 2', 'start', '18:30', 'end', '20:00'),
        jsonb_build_object('day', 'Thứ 5', 'start', '18:30', 'end', '20:00')
      )
    ),
    true
  );

-- Structured class metadata mirrors the operational form: the entered name is
-- kept untouched while the surrounding programme and period distinguish it.
update classes
set
  identity_scheme = case
    when name in ('6C1', '6C2', '6C3') then 'ACADEMIC_YEAR'::class_identity_scheme
    when name in ('7C1', '7C2', '7C3', '7C4') then 'ACADEMIC_YEAR'::class_identity_scheme
    when name in ('L12', 'Kèm 9') then 'ACADEMIC_YEAR'::class_identity_scheme
    else 'INTAKE'::class_identity_scheme
  end,
  class_category = case
    when name in ('6C1', '6C2', '6C3', '7C1', '7C2', '7C3', '7C4', 'L12')
      then 'GENERAL'::class_category
    when name = 'Kèm 9' then 'CUSTOM'::class_category
    else 'IELTS'::class_category
  end,
  grade_mode = case
    when name like 'IELTS%' then 'NONE'::class_grade_mode
    else 'GRADE'::class_grade_mode
  end,
  program_name = null,
  grade_level = case
    when name in ('6C1', '6C2', '6C3') then 6
    when name in ('7C1', '7C2', '7C3', '7C4') then 7
    when name = 'L12' then 12
    when name = 'Kèm 9' then 9
    else null
  end,
  education_level = case
    when name in ('6C1', '6C2', '6C3', '7C1', '7C2', '7C3', '7C4') then 'MIDDLE'
    when name = 'L12' then 'HIGH'
    when name = 'Kèm 9' then 'MIDDLE'
    else null
  end,
  academic_year_start = case
    when name in ('6C1', '6C2', '6C3', '7C1', '7C2', '7C3', '7C4', 'L12', 'Kèm 9')
      then case when extract(month from current_date) >= 8
        then extract(year from current_date)::smallint
        else (extract(year from current_date)::smallint - 1)
      end
    else null
  end,
  end_date = current_date + interval '10 months';

-- Các lớp ở trạng thái khác (sắp mở / đã kết thúc / đã hủy) để test bộ lọc
-- trạng thái trên trang lớp học. 9A1 có 4 buổi/tuần, 2 buổi GV Thu Hà + 2 buổi
-- GV Mai Lan, có trợ giảng — đúng kịch bản phân công theo buổi.
insert into classes (
  name,
  type,
  base_fee,
  billing_cycle_months,
  billing_cycle_weeks,
  start_date,
  end_date,
  schedule,
  is_active,
  identity_scheme,
  class_category,
  grade_mode,
  program_name,
  grade_level,
  education_level,
  academic_year_start,
  cancelled_at
) values
  (
    '9A1',
    'MONTHLY'::class_type,
    850000,
    1,
    null,
    current_date + interval '21 days',
    current_date + interval '10 months',
    jsonb_build_object(
      'text', 'Thứ 2 (17:00-18:30); Thứ 3 (17:00-18:30); Thứ 5 (17:00-18:30); Thứ 6 (17:00-18:30)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 2', 'start', '17:00', 'end', '18:30',
          'teacher_ids', jsonb_build_array('00000000-0000-4000-8000-000000000001'),
          'assistant_ids', jsonb_build_array('00000000-0000-4000-8000-000000000009')),
        jsonb_build_object('day', 'Thứ 3', 'start', '17:00', 'end', '18:30',
          'teacher_ids', jsonb_build_array('00000000-0000-4000-8000-000000000001'),
          'assistant_ids', jsonb_build_array('00000000-0000-4000-8000-000000000009')),
        jsonb_build_object('day', 'Thứ 5', 'start', '17:00', 'end', '18:30',
          'teacher_ids', jsonb_build_array('00000000-0000-4000-8000-000000000002'),
          'assistant_ids', jsonb_build_array('00000000-0000-4000-8000-000000000009')),
        jsonb_build_object('day', 'Thứ 6', 'start', '17:00', 'end', '18:30',
          'teacher_ids', jsonb_build_array('00000000-0000-4000-8000-000000000002'),
          'assistant_ids', jsonb_build_array('00000000-0000-4000-8000-000000000009'))
      )
    ),
    true,
    'ACADEMIC_YEAR'::class_identity_scheme,
    'GENERAL'::class_category,
    'GRADE'::class_grade_mode,
    null,
    9,
    'MIDDLE',
    case when extract(month from current_date) >= 8
      then extract(year from current_date)::smallint
      else (extract(year from current_date)::smallint - 1)
    end,
    null
  ),
  (
    '8B1',
    'MONTHLY'::class_type,
    750000,
    1,
    null,
    current_date - interval '14 months',
    current_date - interval '1 month',
    jsonb_build_object(
      'text', 'Thứ 2 (13:30-15:00); Thứ 4 (13:30-15:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 2', 'start', '13:30', 'end', '15:00'),
        jsonb_build_object('day', 'Thứ 4', 'start', '13:30', 'end', '15:00')
      )
    ),
    true,
    'ACADEMIC_YEAR'::class_identity_scheme,
    'GENERAL'::class_category,
    'GRADE'::class_grade_mode,
    null,
    8,
    'MIDDLE',
    case when extract(month from current_date) >= 8
      then extract(year from current_date)::smallint - 1
      else (extract(year from current_date)::smallint - 2)
    end,
    null
  ),
  (
    'IELTS Cấp tốc',
    'COURSE'::class_type,
    5000000,
    3,
    12,
    current_date - interval '84 days',
    current_date + interval '84 days',
    jsonb_build_object(
      'text', 'Thứ 7 (14:00-16:00); Chủ Nhật (09:00-11:00)',
      'slots', jsonb_build_array(
        jsonb_build_object('day', 'Thứ 7', 'start', '14:00', 'end', '16:00'),
        jsonb_build_object('day', 'Chủ Nhật', 'start', '09:00', 'end', '11:00')
      )
    ),
    true,
    'INTAKE'::class_identity_scheme,
    'IELTS'::class_category,
    'NONE'::class_grade_mode,
    null,
    null,
    null,
    null,
    now()
  );

-- Phân công giáo viên / trợ giảng cho từng lớp (bảng class_teachers) và cột
-- legacy classes.teacher_id (giáo viên đầu tiên). Cả 2 đều dùng staff active.
insert into class_teachers (class_id, teacher_id)
select classes.id, staff_members.id
from (values
  ('6C1', '00000000-0000-4000-8000-000000000001'),
  ('6C1', '00000000-0000-4000-8000-000000000002'),
  ('6C1', '00000000-0000-4000-8000-000000000009'),
  ('6C2', '00000000-0000-4000-8000-000000000001'),
  ('6C2', '00000000-0000-4000-8000-000000000009'),
  ('6C3', '00000000-0000-4000-8000-000000000003'),
  ('6C3', '00000000-0000-4000-8000-00000000000a'),
  ('7C1', '00000000-0000-4000-8000-000000000004'),
  ('7C1', '00000000-0000-4000-8000-000000000005'),
  ('7C1', '00000000-0000-4000-8000-00000000000b'),
  ('7C2', '00000000-0000-4000-8000-000000000004'),
  ('7C2', '00000000-0000-4000-8000-00000000000b'),
  ('7C3', '00000000-0000-4000-8000-000000000005'),
  ('7C3', '00000000-0000-4000-8000-00000000000c'),
  ('7C4', '00000000-0000-4000-8000-000000000006'),
  ('7C4', '00000000-0000-4000-8000-00000000000c'),
  ('Kèm 9', '00000000-0000-4000-8000-000000000007'),
  ('Kèm 9', '00000000-0000-4000-8000-00000000000a'),
  ('L12', '00000000-0000-4000-8000-000000000008'),
  ('L12', '00000000-0000-4000-8000-000000000009'),
  ('IELTS 10', '00000000-0000-4000-8000-000000000001'),
  ('IELTS 10', '00000000-0000-4000-8000-000000000002'),
  ('IELTS 10', '00000000-0000-4000-8000-000000000009'),
  ('IELTS Tổng hợp', '00000000-0000-4000-8000-000000000003'),
  ('IELTS Tổng hợp', '00000000-0000-4000-8000-00000000000b'),
  ('IELTS Chuyên sâu', '00000000-0000-4000-8000-000000000005'),
  ('IELTS Chuyên sâu', '00000000-0000-4000-8000-000000000006'),
  ('IELTS Chuyên sâu', '00000000-0000-4000-8000-00000000000c'),
  ('9A1', '00000000-0000-4000-8000-000000000001'),
  ('9A1', '00000000-0000-4000-8000-000000000002'),
  ('9A1', '00000000-0000-4000-8000-000000000009'),
  ('8B1', '00000000-0000-4000-8000-000000000004'),
  ('8B1', '00000000-0000-4000-8000-00000000000a'),
  ('IELTS Cấp tốc', '00000000-0000-4000-8000-000000000007'),
  ('IELTS Cấp tốc', '00000000-0000-4000-8000-00000000000b')
) as assignment(class_name, teacher_id)
join classes on classes.name = assignment.class_name
join staff_members on staff_members.id = assignment.teacher_id::uuid;

-- Cột legacy classes.teacher_id trỏ tới giáo viên (TEACHER) đầu tiên.
update classes
set teacher_id = assignment.teacher_id::uuid
from (
  select distinct on (class_name) class_name, teacher_id
  from (values
    ('6C1', '00000000-0000-4000-8000-000000000001'),
    ('6C2', '00000000-0000-4000-8000-000000000001'),
    ('6C3', '00000000-0000-4000-8000-000000000003'),
    ('7C1', '00000000-0000-4000-8000-000000000004'),
    ('7C2', '00000000-0000-4000-8000-000000000004'),
    ('7C3', '00000000-0000-4000-8000-000000000005'),
    ('7C4', '00000000-0000-4000-8000-000000000006'),
    ('Kèm 9', '00000000-0000-4000-8000-000000000007'),
    ('L12', '00000000-0000-4000-8000-000000000008'),
    ('IELTS 10', '00000000-0000-4000-8000-000000000001'),
    ('IELTS Tổng hợp', '00000000-0000-4000-8000-000000000003'),
    ('IELTS Chuyên sâu', '00000000-0000-4000-8000-000000000005'),
    ('9A1', '00000000-0000-4000-8000-000000000001'),
    ('8B1', '00000000-0000-4000-8000-000000000004'),
    ('IELTS Cấp tốc', '00000000-0000-4000-8000-000000000007')
  ) as legacy(class_name, teacher_id)
  order by class_name, teacher_id
) assignment
where classes.name = assignment.class_name;

-- Gán GV riêng theo từng buổi cho IELTS 10 (3 buổi: Thu Hà / Mai Lan / cả hai).
update classes
set schedule = jsonb_set(
  schedule,
  '{slots}',
  jsonb_build_array(
    jsonb_build_object('day', 'Thứ 4', 'start', '18:30', 'end', '20:00',
      'teacher_ids', jsonb_build_array('00000000-0000-4000-8000-000000000001'),
      'assistant_ids', jsonb_build_array('00000000-0000-4000-8000-000000000009')),
    jsonb_build_object('day', 'Thứ 6', 'start', '18:30', 'end', '20:00',
      'teacher_ids', jsonb_build_array('00000000-0000-4000-8000-000000000002'),
      'assistant_ids', jsonb_build_array('00000000-0000-4000-8000-000000000009')),
    jsonb_build_object('day', 'Thứ 7', 'start', '08:00', 'end', '10:00',
      'teacher_ids', jsonb_build_array(
        '00000000-0000-4000-8000-000000000001',
        '00000000-0000-4000-8000-000000000002'),
      'assistant_ids', jsonb_build_array('00000000-0000-4000-8000-000000000009'))
  )
)
where name = 'IELTS 10';

create temporary table seed_students (
  full_name text primary key,
  birth_year smallint,
  school text,
  parent_name text,
  parent_phone text,
  parent_zalo_name text
) on commit drop;

insert into seed_students values
  ('Nguyễn An Khang', 2014, 'THCS Chu Văn An', 'Nguyễn Hoàng Bình', '0901122334', 'Mẹ Khang Bảo'),
  ('Lê Gia Bảo', 2014, 'THCS Chu Văn An', 'Nguyễn Hoàng Bình', '0901122334', 'Mẹ Khang Bảo'),
  ('Phạm Minh Khoa', 2014, 'THCS Lý Thường Kiệt', 'Phạm Thanh Sơn', '0912233445', 'Ba Khoa'),
  ('Võ Hà My', 2014, 'THCS Nguyễn Du', 'Võ Thanh Hà', '0934455667', 'Hà My Mẹ'),
  ('Trần Nhật Minh', 2014, 'THCS Tây Sơn', 'Trần Quốc Huy', '0987654321', 'Ba Nhật Minh'),
  ('Đỗ Quang Huy', 2014, 'THCS Tây Sơn', 'Đỗ Minh Tâm', '0971122334', 'Mẹ Quang Huy'),
  ('Huỳnh Bảo Ngọc', 2014, 'THCS Nguyễn Huệ', 'Huỳnh Anh Tuấn', '0962233445', 'Ngọc Huỳnh PH'),
  ('Mai Anh Thư', 2014, 'THCS Nguyễn Huệ', 'Mai Thu Hà', '0356677889', 'Mẹ Anh Thư'),
  ('Phan Đức Anh', 2014, 'THCS Nguyễn Trãi', 'Phan Đức Long', '0381122446', 'Ba Đức Anh'),
  ('Bùi Khánh Linh', 2013, 'THCS Nguyễn Trãi', 'Bùi Minh Châu', '0392233557', 'Linh Châu'),
  ('Trương Minh Đức', 2013, 'THCS Lê Lợi', 'Trương Văn Nam', '0701122334', 'Ba Minh Đức'),
  ('Nguyễn Hoàng Phúc', 2013, 'THCS Lê Lợi', 'Nguyễn Thanh Phong', '0772233445', 'Phong PH'),
  ('Trần Bảo Hân', 2013, 'THCS Marie Curie', 'Trần Thị Hạnh', '0783344556', 'Mẹ Bảo Hân'),
  ('Lê Nhật Vy', 2013, 'THCS Marie Curie', 'Lê Quốc Việt', '0794455667', 'Nhật Vy PH'),
  ('Phạm Gia Huy', 2013, 'THCS Nguyễn Du', 'Phạm Anh Khoa', '0831122334', 'Ba Gia Huy'),
  ('Võ Minh Quân', 2013, 'THCS Tây Sơn', 'Võ Hoàng Dũng', '0842233445', 'Quân Dũng'),
  ('Nguyễn Thanh Trúc', 2013, 'THCS Tây Sơn', 'Nguyễn Thị Lan', '0853344556', 'Mẹ Thanh Trúc'),
  ('Hồ Khánh An', 2013, 'THCS Lý Thường Kiệt', 'Hồ Minh Quang', '0864455667', 'Khánh An PH'),
  ('Lê Anh Khoa', 2012, 'THCS Nguyễn Huệ', 'Lê Đức Tài', '0871122334', 'Ba Anh Khoa'),
  ('Nguyễn Phương Mai', 2012, 'THCS Nguyễn Huệ', 'Nguyễn Thu Hương', '0882233445', 'Mai Hương'),
  ('Phan Minh Châu', 2012, 'THCS Chu Văn An', 'Phan Quốc Hưng', '0893344556', 'Ba Minh Châu'),
  ('Huỳnh Tấn Phát', 2012, 'THCS Chu Văn An', 'Huỳnh Văn Lộc', '0321122334', 'Phát Lộc'),
  ('Võ Quốc Hưng', 2011, 'THCS Tây Sơn', 'Võ Thị Mai', '0332233445', 'Mẹ Quốc Hưng'),
  ('Trịnh Hà Anh', 2011, 'THCS Lê Lợi', 'Trịnh Minh Tuấn', '0343344556', 'Hà Anh PH'),
  ('Trần Đức Thịnh', 2008, 'THPT Lê Quý Đôn', 'Trần Đức Hoà', '0361122334', 'Ba Đức Thịnh'),
  ('Phạm Ngọc Ánh', 2008, 'THPT Nguyễn Trãi', 'Phạm Thị Ngọc', '0372233445', 'Mẹ Ngọc Ánh'),
  ('Nguyễn Minh Tuấn', 2009, 'THPT Lê Quý Đôn', 'Nguyễn Văn Bình', '0905123456', 'Bình Tuấn PH'),
  ('Trần Thị Lan', 2010, 'THCS Nguyễn Huệ', 'Trần Thị Mai', '0912345678', 'Mai Lan mama'),
  ('Lê Quang Huy', 2011, 'THCS Tây Sơn', 'Lê Văn Hùng', '0934567890', 'Hùng bố Huy'),
  ('Hoàng Bảo Trâm', 2009, 'THPT Gia Định', 'Hoàng Thanh Phúc', '0945678901', 'Trâm Hoàng PH'),
  ('Đinh Gia Hân', 2010, 'THPT Trần Phú', 'Đinh Minh Hải', '0956789012', 'Gia Hân PH'),
  ('Vũ Thanh Long', 2010, 'THPT Trần Phú', 'Vũ Anh Duy', '0967890123', 'Long Duy'),
  ('Nguyễn Bảo Vy', 2010, 'THPT Nguyễn Thị Minh Khai', 'Nguyễn Bảo Quốc', '0978901234', 'Bảo Vy PH'),
  ('Phạm Hoàng Nam', 2008, 'Đại học năm 1', 'Phạm Quốc Cường', '0989012345', 'Hoàng Nam PH'),
  ('Lê Mai Chi', 2008, 'Đại học năm 1', 'Lê Thị Thu', '0990123456', 'Mai Chi PH');

insert into students (
  full_name,
  birth_date,
  school,
  parent_name,
  parent_phone,
  parent_zalo,
  status
)
select
  full_name,
  make_date(birth_year, 1, 1),
  school,
  parent_name,
  parent_phone,
  parent_zalo_name,
  'active'::student_status
from seed_students;

create temporary table seed_enrollments (
  full_name text,
  class_name text,
  enrollment_date date,
  custom_fee numeric(12, 0),
  fee_state text
) on commit drop;

with d as (
  select date_trunc('month', current_date)::date as month_start
),
raw_seed (
  full_name,
  class_name,
  cycle_kind,
  due_day,
  custom_fee,
  fee_state
) as (
  values
    ('Nguyễn An Khang', '6C1', 'monthly_due', 3, null::numeric, 'UNNOTIFIED'),
    ('Lê Gia Bảo', '6C1', 'monthly_due', 5, null::numeric, 'NOTIFIED_UNPAID'),
    ('Phạm Minh Khoa', '6C1', 'monthly_due', 7, 700000::numeric, 'PAID'),
    ('Võ Hà My', '6C1', 'monthly_not_due', 20, null::numeric, 'NOT_DUE'),
    ('Trần Nhật Minh', '6C2', 'monthly_due', 4, null::numeric, 'PAID'),
    ('Đỗ Quang Huy', '6C2', 'monthly_due', 8, null::numeric, 'UNNOTIFIED'),
    ('Huỳnh Bảo Ngọc', '6C2', 'monthly_due', 10, 720000::numeric, 'NOTIFIED_UNPAID'),
    ('Mai Anh Thư', '6C2', 'monthly_due', 16, null::numeric, 'PAID'),
    ('Phan Đức Anh', '6C3', 'monthly_due', 6, null::numeric, 'NOTIFIED_UNPAID'),
    ('Bùi Khánh Linh', '6C3', 'monthly_due', 9, null::numeric, 'PAID'),
    ('Trương Minh Đức', '6C3', 'monthly_due', 13, 730000::numeric, 'UNNOTIFIED'),
    ('Nguyễn Hoàng Phúc', '7C1', 'monthly_due', 2, null::numeric, 'PAID'),
    ('Trần Bảo Hân', '7C1', 'monthly_due', 11, null::numeric, 'NOTIFIED_UNPAID'),
    ('Lê Nhật Vy', '7C1', 'monthly_due', 18, 760000::numeric, 'UNNOTIFIED'),
    ('Phạm Gia Huy', '7C2', 'monthly_due', 5, null::numeric, 'PAID'),
    ('Võ Minh Quân', '7C2', 'monthly_due', 12, null::numeric, 'NOTIFIED_UNPAID'),
    ('Nguyễn Thanh Trúc', '7C2', 'monthly_due', 19, 850000::numeric, 'UNNOTIFIED'),
    ('Hồ Khánh An', '7C2', 'monthly_not_due', 22, null::numeric, 'NOT_DUE'),
    ('Lê Anh Khoa', '7C3', 'monthly_due', 4, null::numeric, 'NOTIFIED_UNPAID'),
    ('Nguyễn Phương Mai', '7C3', 'monthly_due', 14, null::numeric, 'PAID'),
    ('Phan Minh Châu', '7C4', 'monthly_due', 6, null::numeric, 'UNNOTIFIED'),
    ('Huỳnh Tấn Phát', '7C4', 'monthly_due', 15, null::numeric, 'PAID'),
    ('Võ Quốc Hưng', 'Kèm 9', 'monthly_due', 1, 1100000::numeric, 'NOTIFIED_UNPAID'),
    ('Trịnh Hà Anh', 'Kèm 9', 'monthly_due', 17, null::numeric, 'PAID'),
    ('Trần Đức Thịnh', 'L12', 'monthly_due', 5, null::numeric, 'UNNOTIFIED'),
    ('Phạm Ngọc Ánh', 'L12', 'monthly_due', 20, null::numeric, 'NOTIFIED_UNPAID'),
    ('Nguyễn Minh Tuấn', 'IELTS 10', 'course12_due', 1, null::numeric, 'PAID'),
    ('Trần Thị Lan', 'IELTS 10', 'course12_due', 9, 4200000::numeric, 'UNNOTIFIED'),
    ('Lê Quang Huy', 'IELTS 10', 'course12_due', 15, null::numeric, 'NOTIFIED_UNPAID'),
    ('Hoàng Bảo Trâm', 'IELTS 10', 'course12_due', 24, null::numeric, 'PAID'),
    ('Đinh Gia Hân', 'IELTS Tổng hợp', 'course24_due', 2, null::numeric, 'NOTIFIED_UNPAID'),
    ('Vũ Thanh Long', 'IELTS Tổng hợp', 'course24_due', 18, 7600000::numeric, 'PAID'),
    ('Nguyễn Bảo Vy', 'IELTS Tổng hợp', 'course24_due', 25, null::numeric, 'UNNOTIFIED'),
    ('Phạm Hoàng Nam', 'IELTS Chuyên sâu', 'course48_due', 6, null::numeric, 'PAID'),
    ('Lê Mai Chi', 'IELTS Chuyên sâu', 'course48_due', 23, 12800000::numeric, 'NOTIFIED_UNPAID'),
    ('Nguyễn Minh Tuấn', 'L12', 'monthly_due', 12, 950000::numeric, 'NOTIFIED_UNPAID'),
    ('Trần Thị Lan', '7C2', 'monthly_due', 9, null::numeric, 'PAID'),
    ('Lê Quang Huy', 'Kèm 9', 'monthly_not_due', 21, null::numeric, 'NOT_DUE')
)
insert into seed_enrollments (
  full_name,
  class_name,
  enrollment_date,
  custom_fee,
  fee_state
)
select
  raw_seed.full_name,
  raw_seed.class_name,
  case raw_seed.cycle_kind
    when 'monthly_due' then
      (d.month_start - interval '1 month' + (raw_seed.due_day - 1) * interval '1 day')::date
    when 'monthly_not_due' then
      (d.month_start + (raw_seed.due_day - 1) * interval '1 day')::date
    when 'course12_due' then
      (d.month_start + (raw_seed.due_day - 1) * interval '1 day' - interval '84 days')::date
    when 'course24_due' then
      (d.month_start + (raw_seed.due_day - 1) * interval '1 day' - interval '168 days')::date
    when 'course48_due' then
      (d.month_start + (raw_seed.due_day - 1) * interval '1 day' - interval '336 days')::date
  end,
  raw_seed.custom_fee,
  raw_seed.fee_state
from raw_seed
cross join d;

insert into enrollments (
  student_id,
  class_id,
  enrollment_date,
  custom_fee,
  status
)
select
  students.id,
  classes.id,
  seed_enrollments.enrollment_date,
  seed_enrollments.custom_fee,
  'active'::enrollment_status
from seed_enrollments
join students on students.full_name = seed_enrollments.full_name
join classes on classes.name = seed_enrollments.class_name;

create or replace function get_due_date(
  p_enrollment_date date,
  p_class_type class_type,
  p_billing_cycle_months smallint
)
returns date
language sql
immutable
as $$
  select case
    when p_class_type = 'MONTHLY'::class_type then
      (p_enrollment_date + interval '1 month')::date
    when p_billing_cycle_months = 2 then
      (p_enrollment_date + interval '56 days')::date
    when p_billing_cycle_months = 3 then
      (p_enrollment_date + interval '84 days')::date
    when p_billing_cycle_months = 6 then
      (p_enrollment_date + interval '168 days')::date
    when p_billing_cycle_months = 12 then
      (p_enrollment_date + interval '336 days')::date
    else
      (p_enrollment_date + make_interval(months => p_billing_cycle_months::int))::date
  end
$$;

insert into fee_records (
  enrollment_id,
  period,
  base_amount,
  discount_amount,
  status,
  notified_at,
  notification_channel,
  notification_message,
  paid_amount,
  paid_date,
  note,
  student_name_snapshot,
  class_name_snapshot,
  class_type_snapshot,
  billing_cycle_months_snapshot
)
select
  enrollments.id,
  to_char(current_date, 'YYYY-MM'),
  coalesce(seed_enrollments.custom_fee, classes.base_fee),
  0,
  case
    when seed_enrollments.fee_state = 'PAID' then 'PAID'::fee_status
    else 'UNPAID'::fee_status
  end,
  case
    when seed_enrollments.fee_state in ('NOTIFIED_UNPAID', 'PAID')
      then (date_trunc('month', current_date)::date + (least(extract(day from get_due_date(seed_enrollments.enrollment_date, classes.type, classes.billing_cycle_months)), extract(day from (date_trunc('month', current_date) + interval '1 month' - interval '1 day')))::int - 1) * interval '1 day') - interval '2 days'
    else null
  end,
  case
    when seed_enrollments.fee_state in ('NOTIFIED_UNPAID', 'PAID') then 'zalo_copy'
    else null
  end,
  case
    when seed_enrollments.fee_state in ('NOTIFIED_UNPAID', 'PAID') then
      'TPRO English thông báo học phí của em '
      || students.full_name
      || ' - '
      || classes.name
      || ' đến hạn ngày '
      || to_char((date_trunc('month', current_date)::date + (least(extract(day from get_due_date(seed_enrollments.enrollment_date, classes.type, classes.billing_cycle_months)), extract(day from (date_trunc('month', current_date) + interval '1 month' - interval '1 day')))::int - 1) * interval '1 day'), 'DD/MM/YYYY')
      || '. Số tiền: '
      || replace(to_char(coalesce(seed_enrollments.custom_fee, classes.base_fee), 'FM999G999G999G999'), ',', '.')
      || 'đ. Phụ huynh vui lòng thanh toán giúp trung tâm. Cảm ơn phụ huynh.'
    else null
  end,
  case
    when seed_enrollments.fee_state = 'PAID' then coalesce(seed_enrollments.custom_fee, classes.base_fee)
    else null
  end,
  case
    when seed_enrollments.fee_state = 'PAID'
      then (date_trunc('month', current_date)::date + (least(extract(day from get_due_date(seed_enrollments.enrollment_date, classes.type, classes.billing_cycle_months)), extract(day from (date_trunc('month', current_date) + interval '1 month' - interval '1 day')))::int - 1) * interval '1 day') + interval '2 days'
    else null
  end,
  case
    when seed_enrollments.custom_fee is not null then 'Seed: học phí riêng'
    else 'Seed: học phí mặc định'
  end,
  students.full_name,
  classes.name,
  classes.type,
  classes.billing_cycle_months
from seed_enrollments
join students on students.full_name = seed_enrollments.full_name
join classes on classes.name = seed_enrollments.class_name
join enrollments on enrollments.student_id = students.id and enrollments.class_id = classes.id
where seed_enrollments.fee_state <> 'NOT_DUE';

insert into payments (
  fee_record_id,
  amount,
  payment_date,
  payment_method,
  note
)
select
  fee_records.id,
  fee_records.paid_amount,
  fee_records.paid_date,
  case
    when row_number() over (order by fee_records.paid_date, fee_records.id) % 3 = 0
      then 'cash'::payment_method
    else 'bank_transfer'::payment_method
  end,
  'Seed: thanh toán học phí test'
from fee_records
where fee_records.status = 'PAID';

-- Khôi phục toàn bộ trigger đã tắt khi bắt đầu seed.
do $$
declare
  tbl text;
  seed_tables text[] := array[
    'public.classes',
    'public.class_lifecycle_events',
    'public.class_teacher_events',
    'public.class_teachers',
    'public.student_lifecycle_events',
    'public.students',
    'public.enrollments',
    'public.fee_records',
    'public.payments',
    'public.fee_operations',
    'public.fee_operation_items',
    'public.staff_members'
  ];
begin
  foreach tbl in array seed_tables loop
    if to_regclass(tbl) is not null then
      execute format('alter table %s enable trigger user', tbl);
    end if;
  end loop;
end
$$;

commit;

drop function if exists get_due_date(date, class_type, smallint);
