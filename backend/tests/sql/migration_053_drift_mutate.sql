-- Drift mutation cho 053: drop constraint duration (hợp lệ về mặt SQL, sai
-- về shape đã khóa). Rerun 053 phải ABORT; rollback phải ABORT; dữ liệu
-- operational_end_date giữ nguyên.
alter table public.class_session_exceptions
  drop constraint class_session_exceptions_replacement_duration_check;
