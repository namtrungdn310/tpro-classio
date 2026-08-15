-- Negative fixture cho 053: thay thế bảng class_session_exceptions bằng bảng
-- malformed (thiếu cột/constraint) -> preflight 053 phải ABORT (drift detected).
-- Cleanup: migration_053_negative_cleanup.sql xóa bảng malformed; sau đó 053
-- áp dụng sạch trên schema không có đối tượng mới.

drop table if exists public.class_schedule_adjustment_events;
drop table if exists public.class_session_student_snapshots;
drop table if exists public.class_session_staff_snapshots;
drop table if exists public.class_session_exceptions;
drop table if exists public.class_schedule_adjustments;

create table public.class_session_exceptions (
  id uuid primary key,
  class_id uuid,
  original_start_at timestamptz
);

insert into public.class_session_exceptions (id, class_id, original_start_at)
values (
  '30000000-0000-0000-0000-000000000090',
  '50000000-0000-0000-0000-000000000001',
  '2026-09-07T11:00:00+00:00'
);
