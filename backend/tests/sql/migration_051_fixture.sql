-- Fixture cho migration 051 test (chạy trên DB disposable, sau 001-050)
-- Staff
insert into public.staff_members (id, full_name, staff_type, is_active, zalo_name, phone)
values
  ('10000000-0000-0000-0000-000000000001', 'Cô Hạnh', 'TEACHER', true, 'hanh', '0900000001'),
  ('10000000-0000-0000-0000-000000000002', 'Thầy Phúc', 'TEACHER', true, 'phuc', '0900000002'),
  ('10000000-0000-0000-0000-000000000003', 'Cô Lan', 'ASSISTANT', true, 'lan', '0900000003')
on conflict (id) do nothing;

-- 1. slot thiếu teacher_ids
insert into public.classes (id, name, type, base_fee, billing_cycle_months, teacher_id, identity_scheme, is_active, schedule)
values ('20000000-0000-0000-0000-000000000001', 'C1 legacy missing', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
  '{"text": "Thứ 2 (18:00-19:30)", "slots": [{"day": "Thứ 2", "start": "18:00", "end": "19:30"}]}')
on conflict (id) do nothing;
insert into public.class_teachers (class_id, teacher_id)
values ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- 2. slot teacher_ids = []
insert into public.classes (id, name, type, base_fee, billing_cycle_months, teacher_id, identity_scheme, is_active, schedule)
values ('20000000-0000-0000-0000-000000000002', 'C2 empty array', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
  '{"text": "Thứ 3 (18:00-19:30)", "slots": [{"day": "Thứ 3", "start": "18:00", "end": "19:30", "teacher_ids": [], "assistant_ids": []}]}')
on conflict (id) do nothing;
insert into public.class_teachers (class_id, teacher_id)
values ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')
on conflict do nothing;

-- 3. slot explicit [A] trong pool [A,B]
insert into public.classes (id, name, type, base_fee, billing_cycle_months, teacher_id, identity_scheme, is_active, schedule)
values ('20000000-0000-0000-0000-000000000003', 'C3 explicit', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
  '{"text": "Thứ 4 (18:00-19:30)", "slots": [{"day": "Thứ 4", "start": "18:00", "end": "19:30", "teacher_ids": ["10000000-0000-0000-0000-000000000001"]}]}')
on conflict (id) do nothing;
insert into public.class_teachers (class_id, teacher_id)
values
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002')
on conflict do nothing;

-- 4. mixed: slot1 thiếu, slot2 explicit + assistant, slot3 rỗng — nhiều slot cùng ngày
insert into public.classes (id, name, type, base_fee, billing_cycle_months, teacher_id, identity_scheme, is_active, schedule)
values ('20000000-0000-0000-0000-000000000004', 'C4 mixed', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
  '{"text": "Thứ 6 (07:00-08:30); Thứ 6 (10:00-11:00); Thứ 6 (18:00-19:30)", "slots": [
    {"day": "Thứ 6", "start": "07:00", "end": "08:30"},
    {"day": "Thứ 6", "start": "10:00", "end": "11:00", "teacher_ids": ["10000000-0000-0000-0000-000000000002"], "assistant_ids": ["10000000-0000-0000-0000-000000000003"]},
    {"day": "Thứ 6", "start": "18:00", "end": "19:30", "teacher_ids": []}
  ]}')
on conflict (id) do nothing;
insert into public.class_teachers (class_id, teacher_id)
values
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000002'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003')
on conflict do nothing;

-- 5. class có teacher + assistant membership, slot explicit
insert into public.classes (id, name, type, base_fee, billing_cycle_months, teacher_id, identity_scheme, is_active, schedule)
values ('20000000-0000-0000-0000-000000000005', 'C5 t+a', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
  '{"text": "Thứ 5 (18:00-19:30)", "slots": [{"day": "Thứ 5", "start": "18:00", "end": "19:30", "teacher_ids": ["10000000-0000-0000-0000-000000000001"], "assistant_ids": ["10000000-0000-0000-0000-000000000003"]}]}')
on conflict (id) do nothing;
insert into public.class_teachers (class_id, teacher_id)
values
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000003')
on conflict do nothing;
