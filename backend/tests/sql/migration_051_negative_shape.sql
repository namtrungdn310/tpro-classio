-- N1/N2: schedule non-object / slots non-array — chèn sau khi tạm tháo
-- classes_weekly_schedule_limit_check (044) để chứng minh preflight 051 bắt
-- (dữ liệu legacy có thể tồn tại nếu constraint NOT VALID không validate cũ).
insert into public.classes (id, name, type, base_fee, billing_cycle_months, teacher_id, identity_scheme, is_active, schedule)
values
  ('30000000-0000-0000-0000-000000000001', 'N1 non-object', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true, '[]'),
  ('30000000-0000-0000-0000-000000000002', 'N2 slots obj', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true, '{"text": "x", "slots": {"day": "Thứ 2"}}')
on conflict (id) do nothing;

insert into public.class_teachers (class_id, teacher_id)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001')
on conflict do nothing;
