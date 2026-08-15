-- TPRO Classio — scripts/052_role_snapshot_mapping.sql
--
-- Mapping thủ công cho event MƠ HỒ của migration 052: event không còn link
-- class_teachers/classes.teacher_id nên role tại thời điểm event không có
-- bằng chứng trực tiếp. File này chứa QUYẾT ĐỊNH của con người (owner:
-- người quản trị dữ liệu) dưới dạng UUID + role, KHÔNG chứa PII.
--
-- Chạy TRƯỚC 052 khi preflight báo ambiguous:
--   psql -v ON_ERROR_STOP=1 -f scripts/052_role_snapshot_mapping.sql
-- Rồi chạy 052: event có mapping sẽ được dùng, event mơ hồ không mapping
-- vẫn làm 052 ABORT.
--
-- LƯU Ý: chỉ thêm dòng (event_id, role) đã xác minh. Không commit event_id
-- giả; mọi event_id ở đây phải tồn tại trong class_teacher_events.

create table if not exists public._m052_role_snapshot_mapping (
  event_id uuid primary key references public.class_teacher_events(id) on delete restrict,
  role text not null check (role in ('TEACHER', 'ASSISTANT'))
);

-- Bảng mapping là quyết định audit — khóa chặt như backup 051: RLS + FORCE,
-- ZERO policy (verify_security.sql contract): chỉ migration owner (BYPASSRLS
-- như supabase_admin deploy thật) truy cập qua ownership.
alter table public._m052_role_snapshot_mapping enable row level security;
alter table public._m052_role_snapshot_mapping force row level security;

revoke all on public._m052_role_snapshot_mapping
  from anon, authenticated, service_role, public;

-- Ví dụ (THAY bằng event_id thật khi cần, hoặc để trống nếu không có mơ hồ):
-- insert into public._m052_role_snapshot_mapping (event_id, role) values
--   ('<uuid-event>', 'TEACHER');
