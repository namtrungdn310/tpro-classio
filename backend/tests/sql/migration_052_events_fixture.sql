-- Fixture events cho 052: 3 loại
--   E1: certain — staff còn link class_teachers (TEACHER)
--   E3: certain assistant — còn link (ASSISTANT)
--   E2: ambiguous — staff tồn tại nhưng KHÔNG còn link nào (đã unassign hết)
insert into public.staff_members (id, full_name, staff_type, is_active, zalo_name, phone)
values ('10000000-0000-0000-0000-000000000004', 'Cô Mai', 'TEACHER', true, 'mai', '0900000004')
on conflict (id) do nothing;

insert into public.class_teacher_events (class_id, teacher_id, teacher_name_snapshot, event_type, occurred_at)
values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Cô Hạnh', 'assigned', now() - interval '30 days'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'Cô Lan', 'assigned', now() - interval '20 days'),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000004', 'Cô Mai', 'unassigned', now() - interval '10 days');
