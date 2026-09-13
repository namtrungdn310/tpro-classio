-- Fixture upgrade cho migration 053 (chạy trên DB disposable sau 052):
-- đại diện schema NGAY SAU migration 052: classes (LEGACY + ACADEMIC_YEAR),
-- schedule canonical (mọi slot có teacher_ids), staff + links, enrollments,
-- fee records. Migration 053 phải backfill operational_end_date và giữ nguyên
-- toàn bộ dữ liệu hiện có.

-- Staff (051 fixture đã có Cô Hạnh/Thầy Phúc/Cô Lan; bổ sung nếu thiếu)
insert into public.staff_members (id, full_name, staff_type, is_active, zalo_name, phone)
values
  ('10000000-0000-0000-0000-000000000001', 'Cô Hạnh', 'TEACHER', true, 'hanh', '0900000001'),
  ('10000000-0000-0000-0000-000000000002', 'Thầy Phúc', 'TEACHER', true, 'phuc', '0900000002'),
  ('10000000-0000-0000-0000-000000000003', 'Cô Lan', 'ASSISTANT', true, 'lan', '0900000003')
on conflict (id) do nothing;

-- A: lớp ACTIVE (ACADEMIC_YEAR) hai buổi/tuần — nguồn cho test hoãn/bù
insert into public.classes (
  id, name, type, base_fee, billing_cycle_months, teacher_id, identity_scheme,
  class_category, grade_mode, grade_level, education_level, academic_year_start,
  start_date, end_date, is_active, schedule
)
values (
  '50000000-0000-0000-0000-000000000001',
  'Lớp M053 A', 'MONTHLY', 750000, 1,
  '10000000-0000-0000-0000-000000000001',
  'ACADEMIC_YEAR', 'GENERAL', 'GRADE', 6, 'MIDDLE', 2026,
  '2026-09-01', '2027-05-31', true,
  '{"text": "Thứ 2 (18:00-19:30); Thứ 4 (19:00-20:30)", "slots": [
     {"day": "Thứ 2", "start": "18:00", "end": "19:30",
      "teacher_ids": ["10000000-0000-0000-0000-000000000001"],
      "assistant_ids": ["10000000-0000-0000-0000-000000000003"]},
     {"day": "Thứ 4", "start": "19:00", "end": "20:30",
      "teacher_ids": ["10000000-0000-0000-0000-000000000002"],
      "assistant_ids": ["10000000-0000-0000-0000-000000000003"]}
   ]}'
)
on conflict (id) do nothing;
insert into public.class_teachers (class_id, teacher_id)
values
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002'),
  ('50000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003')
on conflict do nothing;

-- B: lớp SCHEDULED (ACADEMIC_YEAR) một buổi/tuần
insert into public.classes (
  id, name, type, base_fee, billing_cycle_months, teacher_id, identity_scheme,
  class_category, grade_mode, grade_level, education_level, academic_year_start,
  start_date, end_date, is_active, schedule
)
values (
  '50000000-0000-0000-0000-000000000002',
  'Lớp M053 B', 'MONTHLY', 900000, 1,
  '10000000-0000-0000-0000-000000000001',
  'ACADEMIC_YEAR', 'GENERAL', 'GRADE', 7, 'MIDDLE', 2026,
  '2026-10-01', '2027-05-31', true,
  '{"text": "Thứ 6 (10:00-11:00)", "slots": [
     {"day": "Thứ 6", "start": "10:00", "end": "11:00",
      "teacher_ids": ["10000000-0000-0000-0000-000000000001"],
      "assistant_ids": []}
   ]}'
)
on conflict (id) do nothing;
insert into public.class_teachers (class_id, teacher_id)
values
  ('50000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- C: LEGACY — operational_end_date phải giữ NULL
insert into public.classes (
  id, name, type, base_fee, billing_cycle_months, teacher_id, identity_scheme, is_active
)
values (
  '50000000-0000-0000-0000-000000000003',
  'M053 Legacy', 'MONTHLY', 500000, 1,
  '10000000-0000-0000-0000-000000000001',
  'LEGACY', true
)
on conflict (id) do nothing;

-- Học viên + enrollment
insert into public.students (id, full_name, status)
values
  ('60000000-0000-0000-0000-000000000001', 'Nguyễn Văn An', 'active'),
  ('60000000-0000-0000-0000-000000000002', 'Trần Thị Bình', 'active')
on conflict (id) do nothing;

insert into public.enrollments (id, student_id, class_id, enrollment_date, status)
values
  ('70000000-0000-0000-0000-000000000001', '60000000-0000-0000-0000-000000000001',
   '50000000-0000-0000-0000-000000000001', '2026-09-01', 'active'),
  ('70000000-0000-0000-0000-000000000002', '60000000-0000-0000-0000-000000000002',
   '50000000-0000-0000-0000-000000000001', '2026-09-01', 'dropped')
on conflict (id) do nothing;

-- Fee record (chứng minh financial isolation khi chạy verify sau 053)
insert into public.fee_records (
  enrollment_id, period, base_amount, discount_amount, status
)
values (
  '70000000-0000-0000-0000-000000000001',
  '2026-09', 750000, 0, 'UNPAID'
)
on conflict (enrollment_id, period) do nothing;
