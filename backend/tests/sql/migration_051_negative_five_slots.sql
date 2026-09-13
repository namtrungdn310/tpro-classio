-- N3: 5 slots (> 4) — chèn sau khi tạm tháo constraint
-- classes_schedule_max_four_slots_check (042) / classes_weekly_schedule_limit_check
-- (044) để chứng minh preflight 051 vẫn bắt >4 slots (dữ liệu legacy NOT VALID).
insert into public.classes (id, name, type, base_fee, billing_cycle_months, teacher_id, identity_scheme, is_active, schedule)
values ('30000000-0000-0000-0000-000000000003', 'N3 five slots', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "5 slots", "slots": [
      {"day": "Thứ 2", "start": "07:00", "end": "08:00"},
      {"day": "Thứ 2", "start": "08:00", "end": "09:00"},
      {"day": "Thứ 2", "start": "09:00", "end": "10:00"},
      {"day": "Thứ 2", "start": "10:00", "end": "11:00"},
      {"day": "Thứ 2", "start": "11:00", "end": "12:00"}]}')
on conflict (id) do nothing;

insert into public.class_teachers (class_id, teacher_id)
values ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001')
on conflict do nothing;
