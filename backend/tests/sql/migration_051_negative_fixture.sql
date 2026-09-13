-- Negative fixture cho 051: mỗi class vi phạm MỘT quy tắc contract.
-- N1 (non-object) / N2 (slots non-array) / N3 (>4 slots) bị DB constraints
-- (042/044) chặn ở INSERT — test riêng qua migration_051_negative_shape.sql /
-- migration_051_negative_five_slots.sql với constraint tạm tháo.
-- Chạy 051 với ON_ERROR_STOP=1 phải ABORT; transaction rollback sạch.

insert into public.classes (id, name, type, base_fee, billing_cycle_months, teacher_id, identity_scheme, is_active, schedule)
values
  -- N4: day lạ
  ('30000000-0000-0000-0000-000000000004', 'N4 bad day', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "x", "slots": [{"day": "Thứ 9", "start": "07:00", "end": "08:00"}]}'),
  -- N5: 07:15 không thuộc mốc 30 phút
  ('30000000-0000-0000-0000-000000000005', 'N5 off-grid', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "x", "slots": [{"day": "Thứ 2", "start": "07:15", "end": "08:15"}]}'),
  -- N6: 06:30 ngoài range
  ('30000000-0000-0000-0000-000000000006', 'N6 early', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "x", "slots": [{"day": "Thứ 2", "start": "06:30", "end": "07:30"}]}'),
  -- N7: 30 phút
  ('30000000-0000-0000-0000-000000000007', 'N7 30min', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "x", "slots": [{"day": "Thứ 2", "start": "10:00", "end": "10:30"}]}'),
  -- N8: overlap cùng ngày (10-11 và 10:30-11:30)
  ('30000000-0000-0000-0000-000000000008', 'N8 overlap', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "x", "slots": [
      {"day": "Thứ 2", "start": "10:00", "end": "11:00"},
      {"day": "Thứ 2", "start": "10:30", "end": "11:30"}]}'),
  -- N9: duplicate teacher
  ('30000000-0000-0000-0000-000000000009', 'N9 dup teacher', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "x", "slots": [{"day": "Thứ 2", "start": "10:00", "end": "11:00", "teacher_ids": ["10000000-0000-0000-0000-000000000001", "10000000-0000-0000-0000-000000000001"]}]}'),
  -- N10: duplicate assistant
  ('30000000-0000-0000-0000-000000000010', 'N10 dup assistant', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "x", "slots": [{"day": "Thứ 2", "start": "10:00", "end": "11:00", "assistant_ids": ["10000000-0000-0000-0000-000000000003", "10000000-0000-0000-0000-000000000003"]}]}'),
  -- N11: 11 teacher IDs
  ('30000000-0000-0000-0000-000000000011', 'N11 11 teachers', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "x", "slots": [{"day": "Thứ 2", "start": "10:00", "end": "11:00", "teacher_ids": [
      "10000000-0000-0000-0000-000000000001", "10000000-0000-0000-0000-000000000002", "10000000-0000-0000-0000-000000000004",
      "10000000-0000-0000-0000-000000000005", "10000000-0000-0000-0000-000000000006", "10000000-0000-0000-0000-000000000007",
      "10000000-0000-0000-0000-000000000008", "10000000-0000-0000-0000-000000000009", "10000000-0000-0000-0000-000000000010",
      "10000000-0000-0000-0000-000000000011", "10000000-0000-0000-0000-000000000012"]}]}'),
  -- N12: 11 assistant IDs
  ('30000000-0000-0000-0000-000000000012', 'N12 11 assistants', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "x", "slots": [{"day": "Thứ 2", "start": "10:00", "end": "11:00", "assistant_ids": [
      "10000000-0000-0000-0000-000000000003", "10000000-0000-0000-0000-000000000013", "10000000-0000-0000-0000-000000000014",
      "10000000-0000-0000-0000-000000000015", "10000000-0000-0000-0000-000000000016", "10000000-0000-0000-0000-000000000017",
      "10000000-0000-0000-0000-000000000018", "10000000-0000-0000-0000-000000000019", "10000000-0000-0000-0000-000000000020",
      "10000000-0000-0000-0000-000000000021", "10000000-0000-0000-0000-000000000022"]}]}'),
  -- N13: cross-role (cùng ID ở cả hai role)
  ('30000000-0000-0000-0000-000000000013', 'N13 cross-role', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "x", "slots": [{"day": "Thứ 2", "start": "10:00", "end": "11:00", "teacher_ids": ["10000000-0000-0000-0000-000000000001"], "assistant_ids": ["10000000-0000-0000-0000-000000000001"]}]}'),
  -- N14: teacher ngoài junction (staff không link class này)
  ('30000000-0000-0000-0000-000000000014', 'N14 outside junction', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "x", "slots": [{"day": "Thứ 2", "start": "10:00", "end": "11:00", "teacher_ids": ["10000000-0000-0000-0000-000000000004"]}]}'),
  -- N15: assistant sai role (TEACHER trong assistant_ids)
  ('30000000-0000-0000-0000-000000000015', 'N15 wrong role', 'MONTHLY', 750000, 1, '10000000-0000-0000-0000-000000000001', 'LEGACY', true,
   '{"text": "x", "slots": [{"day": "Thứ 2", "start": "10:00", "end": "11:00", "assistant_ids": ["10000000-0000-0000-0000-000000000001"]}]}')
on conflict (id) do nothing;

-- N14/N15 cần staff tồn tại
insert into public.staff_members (id, full_name, staff_type, is_active, zalo_name, phone)
values
  ('10000000-0000-0000-0000-000000000004', 'Cô Mai', 'TEACHER', true, 'mai', '0900000004')
on conflict (id) do nothing;

-- Junction cho các class hợp lệ phần khác (N14/N15 cố ý KHÔNG có link)
insert into public.class_teachers (class_id, teacher_id)
select id, '10000000-0000-0000-0000-000000000001'
  from public.classes
 where id::text like '30000000-0000-0000-0000-0000000000%'
   and id <> '30000000-0000-0000-0000-000000000014'
on conflict do nothing;
