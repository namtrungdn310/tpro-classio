-- Negative fixture cho 052: event MƠ HỒ — staff tồn tại nhưng đã unassign hết.
-- 052 phải ABORT với total + sample <= 20; không đoán role bằng current staff.
-- Cột staff_type_snapshot NOT NULL (052 đã chạy ở scenario 1) — tạm tháo
-- NOT NULL để insert event "chưa có snapshot" như dữ liệu legacy.
-- KHÔNG khôi phục ở đây: pipeline dọn event rồi set not null lại (s4-052-cleanup).
alter table public.class_teacher_events
  alter column staff_type_snapshot drop not null;

insert into public.staff_members (id, full_name, staff_type, is_active, zalo_name, phone)
values ('10000000-0000-0000-0000-000000000044', 'Cô Nga', 'TEACHER', true, 'nga', '0900000044')
on conflict (id) do nothing;

insert into public.class_teacher_events (class_id, teacher_id, teacher_name_snapshot, event_type, occurred_at)
select c.id, '10000000-0000-0000-0000-000000000044', 'Cô Nga', 'unassigned', now() - interval '5 days'
  from public.classes c
 where c.id = '20000000-0000-0000-0000-000000000005'
on conflict do nothing;
