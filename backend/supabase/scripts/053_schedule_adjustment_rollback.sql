-- TPRO Classio — scripts/053_schedule_adjustment_rollback.sql (Round 5)
--
-- Rollback an toàn migration 053. Preflight:
--   1. Mọi bảng mới KHÔNG được có dữ liệu (bảo toàn dữ liệu tuyệt đối).
--   2. Không drift: các constraint/trigger quan trọng phải còn nguyên
--      (không chấp nhận rollback mù khi ai đó đã thay đổi shape).
-- Khi bất kỳ điều kiện nào thất bại -> ABORT, không làm gì cả.
--
-- Áp dụng: psql -v ON_ERROR_STOP=1 -f 053_schedule_adjustment_rollback.sql

begin;

do $$
declare
  has_rows text;
  drift text[];
  row_count bigint;
  rel record;
begin
  has_rows := null;
  for rel in select column1 from (
    values
      ('class_schedule_adjustments'),
      ('class_session_exceptions'),
      ('class_session_staff_snapshots'),
      ('class_session_student_snapshots'),
      ('class_schedule_adjustment_events')
  ) as v(column1)
  loop
    if to_regclass('public.' || rel.column1) is not null then
      execute format('select count(*) from public.%I', rel.column1) into row_count;
      if row_count > 0 then
        has_rows := coalesce(has_rows || ', ', '') || rel.column1;
      end if;
    end if;
  end loop;

  if has_rows is not null then
    raise exception
      'M053 rollback aborted: tables still contain business data: %. Dùng migration sửa forward; không xóa dữ liệu.',
      has_rows;
  end if;

  drift := array[]::text[];
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.class_session_exceptions'::regclass
       and conname = 'class_session_exceptions_replacement_duration_check'
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = 'public.class_session_exceptions'::regclass
       and conname = 'class_session_exceptions_state_shape_check'
  ) then
    drift := array_append(drift, 'exception constraints');
  end if;
  if to_regclass('public.ux_class_session_exceptions_active_original') is null then
    drift := array_append(drift, 'active-original unique index');
  end if;
  if not exists (
    select 1 from pg_trigger t
     where t.tgrelid = 'public.class_schedule_adjustment_events'::regclass
       and t.tgname = 'trg_class_schedule_adjustment_events_append_only'
       and not t.tgisinternal and t.tgenabled <> 'D'
  ) then
    drift := array_append(drift, 'append-only trigger');
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'classes'
       and column_name = 'operational_end_date'
  ) then
    drift := array_append(drift, 'operational_end_date column');
  end if;
  if array_length(drift, 1) > 0 then
    raise exception
      'M053 rollback aborted: drift detected (%); không rollback mù. Dùng dump/reconcile thủ công.',
      array_to_string(drift, ', ');
  end if;

  raise notice 'M053 rollback preflight OK: no data, no drift';
end $$;

drop table if exists public.class_schedule_adjustment_events;
drop table if exists public.class_session_student_snapshots;
drop table if exists public.class_session_staff_snapshots;
drop table if exists public.class_session_exceptions;
drop table if exists public.class_schedule_adjustments;
drop function if exists public.block_class_schedule_adjustment_event_mutation();
drop index if exists public.classes_operational_end_idx;
alter table public.classes
  drop constraint if exists classes_operational_end_date_check;
alter table public.classes
  drop column if exists operational_end_date;

commit;

-- M053 rollback OK: all new objects removed; classes/end_date untouched.
