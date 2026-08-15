-- Fixture rollback/reapply (T-DB051-043/044) và drift (T-DB051-045/046):
-- C7 legacy dùng cho rollback scenario; C8 legacy dùng cho drift scenario.
insert into public.classes (id, name, type, base_fee, billing_cycle_months, teacher_id, identity_scheme, is_active, schedule)
values
  ('20000000-0000-0000-0000-000000000007', 'C7 rollback target', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "Thứ 4 (07:00-08:00)", "slots": [{"day": "Thứ 4", "start": "07:00", "end": "08:00"}]}'),
  ('20000000-0000-0000-0000-000000000008', 'C8 drift target', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "Thứ 5 (07:00-08:00)", "slots": [{"day": "Thứ 5", "start": "07:00", "end": "08:00"}]}')
on conflict (id) do nothing;

insert into public.class_teachers (class_id, teacher_id)
values
  ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001')
on conflict do nothing;
