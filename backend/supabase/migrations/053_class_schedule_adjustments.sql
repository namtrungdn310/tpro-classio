-- TPRO Classio — 053_class_schedule_adjustments.sql (Round 5)
--
-- Mục đích:
--   1. `classes.operational_end_date DATE NULL` — ngày kết thúc vận hành,
--      backfill non-LEGACY = planned `end_date`; check `operational_end_date >=
--      end_date`. KHÔNG phải billing input (billing luôn đọc `classes.end_date`).
--   2. `class_schedule_adjustments` — header/lô hoãn (reason, phạm vi ngày,
--      idempotency request_id theo actor).
--   3. `class_session_exceptions` — exception dated của một original occurrence:
--      state machine MAKEUP_PENDING/SCHEDULED/COMPLETED/RESTORED/CANCELLED,
--      replacement đúng duration, sau original, tối đa một active exception.
--   4. `class_session_staff_snapshots` / `class_session_student_snapshots` —
--      snapshot staff original slot + eligibility học viên theo ngày original;
--      KHÔNG chứa contact/private data; không cascade khi staff/student đổi.
--   5. `class_schedule_adjustment_events` — audit append-only, runtime chỉ insert.
--   6. RLS FORCE trên mọi bảng mới; browser roles deny; default ACL đóng hàm.
--
-- Rerun contract: các bảng/cột/constraint đã tồn tại với shape đúng -> no-op;
-- DRIFT (thiếu cột/constraint/index/trigger quan trọng hoặc shape sai) -> ABORT
-- (không ghi đè im lặng). Không tạo lại event history.
--
-- Áp dụng: psql -v ON_ERROR_STOP=1 -f 053_class_schedule_adjustments.sql

begin;

-- Default ACL của migration owner: function mới KHÔNG được public-execute.
alter default privileges
  revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------
-- 1. classes.operational_end_date
-- ---------------------------------------------------------------
do $$
begin
  if not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'classes'
       and column_name = 'operational_end_date'
  ) then
    alter table public.classes
      add column operational_end_date date;
    raise notice 'M053: added classes.operational_end_date';
  else
    raise notice 'M053: classes.operational_end_date already exists';
  end if;
end $$;

-- Backfill: non-LEGACY rows có planned end -> operational_end_date = end_date.
-- LEGACY (không có ngày cấu trúc) giữ NULL cho tới khi được phân loại.
update public.classes
   set operational_end_date = end_date
 where operational_end_date is null
   and identity_scheme <> 'LEGACY'
   and end_date is not null;

-- Constraint: operational_end_date >= end_date khi cả hai non-null.
do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.classes'::regclass
       and conname = 'classes_operational_end_date_check'
       and contype = 'c'
  ) then
    alter table public.classes
      add constraint classes_operational_end_date_check
      check (
        operational_end_date is null
        or end_date is null
        or operational_end_date >= end_date
      );
    raise notice 'M053: added classes_operational_end_date_check';
  end if;
end $$;

-- Index cho lifecycle worker / unresolved scan.
do $$
begin
  if to_regclass('public.classes_operational_end_idx') is null then
    create index classes_operational_end_idx
      on public.classes (operational_end_date)
     where operational_end_date is not null;
  end if;
end $$;

-- ---------------------------------------------------------------
-- Preflight: nếu đối tượng mới đã tồn tại, shape phải khớp — ngược lại ABORT.
-- Rerun thuần (không đổi gì) -> no-op an toàn.
-- ---------------------------------------------------------------
do $$
declare
  drift text[];
begin
  if to_regclass('public.class_session_exceptions') is not null then
    drift := array[]::text[];

    if not exists (
      select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'class_session_exceptions'
         and column_name in ('status', 'replacement_start_at', 'replacement_end_at')
    ) then
      drift := array_append(drift, 'class_session_exceptions columns');
    end if;
    if not exists (
      select 1 from pg_constraint
       where conrelid = 'public.class_session_exceptions'::regclass
         and conname = 'class_session_exceptions_replacement_duration_check'
    ) or not exists (
      select 1 from pg_constraint
       where conrelid = 'public.class_session_exceptions'::regclass
         and conname = 'class_session_exceptions_state_shape_check'
    ) then
      drift := array_append(drift, 'class_session_exceptions constraints');
    end if;
    if to_regclass('public.ux_class_session_exceptions_active_original') is null
       or to_regclass('public.idx_class_session_exceptions_replacement') is null
       or to_regclass('public.idx_class_session_exceptions_unresolved_class') is null then
      drift := array_append(drift, 'class_session_exceptions indexes');
    end if;
    if to_regclass('public.class_session_staff_snapshots') is null
       or to_regclass('public.class_session_student_snapshots') is null
       or to_regclass('public.class_schedule_adjustments') is null
       or to_regclass('public.class_schedule_adjustment_events') is null then
      drift := array_append(drift, 'other new tables');
    else
      if not exists (
        select 1
          from pg_trigger t
         where t.tgrelid = 'public.class_schedule_adjustment_events'::regclass
           and t.tgname = 'trg_class_schedule_adjustment_events_append_only'
           and not t.tgisinternal
           and t.tgenabled <> 'D'
      ) then
        drift := array_append(drift, 'adjustment event append-only trigger');
      end if;
    end if;

    if array_length(drift, 1) > 0 then
      raise exception
        'M053 preflight failed: drift detected, missing: %',
        array_to_string(drift, ', ');
    end if;

    raise notice 'M053 preflight OK: existing shape matches (rerun no-op)';
  end if;
end $$;

-- ---------------------------------------------------------------
-- 2. class_schedule_adjustments (header/lô)
-- ---------------------------------------------------------------
create table if not exists public.class_schedule_adjustments (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  reason_code text not null,
  reason_note text,
  affected_from date not null,
  affected_through date not null,
  status text not null default 'OPEN',
  created_by uuid not null,
  request_id uuid not null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_schedule_adjustments_reason_code_check
    check (reason_code in ('TEACHER_UNAVAILABLE', 'CENTER_OPERATION', 'OTHER')),
  constraint class_schedule_adjustments_status_check
    check (status in ('OPEN', 'CLOSED')),
  constraint class_schedule_adjustments_date_range_check
    check (affected_from <= affected_through),
  constraint class_schedule_adjustments_reason_note_check
    check (
      reason_note is null
      or (
        char_length(reason_note) <= 500
        and reason_note !~ '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]'
      )
    ),
  constraint ux_class_schedule_adjustments_request unique (created_by, request_id)
);

-- Lưu ý: created_by không FK profiles để việc xóa tài khoản (owner operation)
-- không làm gãy audit header — id actor vẫn được lưu như bằng chứng.

create index if not exists idx_class_schedule_adjustments_class
  on public.class_schedule_adjustments (class_id, created_at desc);

-- ---------------------------------------------------------------
-- 3. class_session_exceptions
-- ---------------------------------------------------------------
create table if not exists public.class_session_exceptions (
  id uuid primary key default gen_random_uuid(),
  adjustment_id uuid not null
    references public.class_schedule_adjustments(id) on delete restrict,
  class_id uuid not null references public.classes(id) on delete restrict,
  original_start_at timestamptz not null,
  original_end_at timestamptz not null,
  original_timezone text not null default 'Asia/Ho_Chi_Minh',
  status text not null default 'MAKEUP_PENDING',
  replacement_start_at timestamptz,
  replacement_end_at timestamptz,
  completed_at timestamptz,
  completed_by uuid,
  restored_at timestamptz,
  restored_by uuid,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_session_exceptions_status_check
    check (status in (
      'MAKEUP_PENDING', 'MAKEUP_SCHEDULED',
      'MAKEUP_COMPLETED', 'RESTORED', 'CANCELLED'
    )),
  constraint class_session_exceptions_original_range_check
    check (original_end_at > original_start_at),
  constraint class_session_exceptions_replacement_pair_check
    check ((replacement_start_at is null) = (replacement_end_at is null)),
  constraint class_session_exceptions_replacement_duration_check
    check (
      replacement_start_at is null
      or (replacement_end_at - replacement_start_at) = (original_end_at - original_start_at)
    ),
  constraint class_session_exceptions_replacement_after_original_check
    check (
      replacement_start_at is null
      or replacement_start_at > original_start_at
    ),
  constraint class_session_exceptions_state_shape_check
    check (
      (status = 'MAKEUP_PENDING'
        and replacement_start_at is null and replacement_end_at is null
        and completed_at is null and restored_at is null)
      or (status = 'MAKEUP_SCHEDULED'
        and replacement_start_at is not null and replacement_end_at is not null
        and completed_at is null and restored_at is null)
      or (status = 'MAKEUP_COMPLETED'
        and replacement_start_at is not null and replacement_end_at is not null
        and completed_at is not null and restored_at is null)
      or (status = 'RESTORED'
        and replacement_start_at is null and replacement_end_at is null
        and completed_at is null and restored_at is not null)
      or (status = 'CANCELLED'
        and replacement_start_at is null and replacement_end_at is null
        and completed_at is null and restored_at is null)
    )
);

-- Tối đa MỘT exception active cho (class_id, original_start_at).
create unique index if not exists ux_class_session_exceptions_active_original
  on public.class_session_exceptions (class_id, original_start_at)
 where status in ('MAKEUP_PENDING', 'MAKEUP_SCHEDULED');

-- Completed là business fact bất biến: không được hoãn lại original đã bù xong.
create unique index if not exists ux_class_session_exceptions_completed_original
  on public.class_session_exceptions (class_id, original_start_at)
 where status = 'MAKEUP_COMPLETED';

-- Tra cứu history / overlay theo class + original.
create index if not exists idx_class_session_exceptions_class_original
  on public.class_session_exceptions (class_id, original_start_at);

-- Tra cứu conflict theo replacement interval (half-open [start, end)).
create index if not exists idx_class_session_exceptions_replacement
  on public.class_session_exceptions (replacement_start_at, replacement_end_at)
 where replacement_start_at is not null;

-- Tra cứu unresolved obligation theo class (worker/lifecycle).
create index if not exists idx_class_session_exceptions_unresolved_class
  on public.class_session_exceptions (class_id)
 where status in ('MAKEUP_PENDING', 'MAKEUP_SCHEDULED');

-- ---------------------------------------------------------------
-- 4. Snapshots (staff + student)
-- ---------------------------------------------------------------
create table if not exists public.class_session_staff_snapshots (
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null
    references public.class_session_exceptions(id) on delete cascade,
  staff_id uuid not null references public.staff_members(id) on delete restrict,
  role text not null,
  display_name_snapshot text not null,
  source_slot_key text not null,
  created_at timestamptz not null default now(),
  constraint class_session_staff_snapshots_role_check
    check (role in ('TEACHER', 'ASSISTANT')),
  constraint ux_class_session_staff_snapshots
    unique (exception_id, staff_id, role)
);

-- FK RESTRICT với staff_members: staff bị archive/inactive vẫn giữ snapshot
-- lịch sử (không cascade xóa snapshot lịch sử khi staff lifecycle thay đổi).

create index if not exists idx_class_session_staff_snapshots_staff
  on public.class_session_staff_snapshots (staff_id);

create table if not exists public.class_session_student_snapshots (
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null
    references public.class_session_exceptions(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete restrict,
  enrollment_id uuid not null references public.enrollments(id) on delete restrict,
  student_name_snapshot text not null,
  enrolled_at_snapshot date,
  enrollment_end_snapshot date,
  eligibility_status text not null default 'ELIGIBLE',
  created_at timestamptz not null default now(),
  constraint class_session_student_snapshots_eligibility_check
    check (eligibility_status in ('ELIGIBLE', 'INELIGIBLE')),
  constraint ux_class_session_student_snapshots
    unique (exception_id, enrollment_id)
);

-- Chỉ lưu trường entitlement/display; KHÔNG copy contact/private note.

-- ---------------------------------------------------------------
-- 5. Append-only adjustment events
-- ---------------------------------------------------------------
create table if not exists public.class_schedule_adjustment_events (
  id uuid primary key default gen_random_uuid(),
  exception_id uuid not null
    references public.class_session_exceptions(id) on delete restrict,
  event_type text not null,
  old_payload jsonb,
  new_payload jsonb,
  actor_user_id uuid references public.profiles(id) on delete set null,
  request_id uuid not null,
  created_at timestamptz not null default now(),
  constraint class_schedule_adjustment_events_type_check
    check (event_type in (
      'batch-created', 'postponed', 'scheduled', 'rescheduled',
      'unscheduled', 'completed', 'original-restored',
      'correction-recorded', 'cancelled'
    ))
);

create index if not exists idx_class_schedule_adjustment_events_exception
  on public.class_schedule_adjustment_events (exception_id, created_at);

create or replace function public.block_class_schedule_adjustment_event_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  raise exception 'class schedule adjustment events are append-only'
    using errcode = '42501';
end;
$$;

revoke all on function public.block_class_schedule_adjustment_event_mutation()
  from public, anon, authenticated;

drop trigger if exists trg_class_schedule_adjustment_events_append_only
  on public.class_schedule_adjustment_events;
create trigger trg_class_schedule_adjustment_events_append_only
before update or delete on public.class_schedule_adjustment_events
for each row execute function public.block_class_schedule_adjustment_event_mutation();

drop trigger if exists trg_class_schedule_adjustment_events_truncate
  on public.class_schedule_adjustment_events;
create trigger trg_class_schedule_adjustment_events_truncate
before truncate on public.class_schedule_adjustment_events
for each statement execute function public.block_class_schedule_adjustment_event_mutation();

-- ---------------------------------------------------------------
-- 6. RLS + closed ACL (zero policies trong public schema — convention repo)
-- ---------------------------------------------------------------
alter table public.class_schedule_adjustments enable row level security;
alter table public.class_schedule_adjustments force row level security;
alter table public.class_session_exceptions enable row level security;
alter table public.class_session_exceptions force row level security;
alter table public.class_session_staff_snapshots enable row level security;
alter table public.class_session_staff_snapshots force row level security;
alter table public.class_session_student_snapshots enable row level security;
alter table public.class_session_student_snapshots force row level security;
alter table public.class_schedule_adjustment_events enable row level security;
alter table public.class_schedule_adjustment_events force row level security;

-- Browser roles không nhận bất kỳ quyền nào (mặc định ACL của migration owner
-- đã đóng); xác minh bằng verify_security.sql.

-- ---------------------------------------------------------------
-- Post-check: mọi đối tượng quan trọng tồn tại.
-- ---------------------------------------------------------------
do $$
declare
  missing text;
begin
  if to_regclass('public.class_schedule_adjustments') is null
     or to_regclass('public.class_session_exceptions') is null
     or to_regclass('public.class_session_staff_snapshots') is null
     or to_regclass('public.class_session_student_snapshots') is null
     or to_regclass('public.class_schedule_adjustment_events') is null then
    raise exception 'M053 post-check failed: one or more new tables missing';
  end if;

  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'classes'
       and column_name = 'operational_end_date'
       and data_type = 'date'
  ) then
    raise exception 'M053 post-check failed: classes.operational_end_date missing';
  end if;

  select string_agg(x, ', ')
    into missing
    from (
      values
        ('ux_class_session_exceptions_active_original'),
        ('ux_class_session_exceptions_completed_original'),
        ('ux_class_session_staff_snapshots'),
        ('ux_class_session_student_snapshots'),
        ('ux_class_schedule_adjustments_request'),
        ('idx_class_session_exceptions_replacement'),
        ('idx_class_session_exceptions_unresolved_class')
    ) as v(x)
    left join pg_indexes i
      on i.schemaname = 'public'
     and i.indexname = v.x
   where i.indexname is null;

  if missing is not null then
    raise exception 'M053 post-check failed: missing indexes/unique: %', missing;
  end if;

  raise notice 'M053 post-check OK: all new objects present';
end $$;

commit;

-- Rollback (thủ công, transaction riêng — xem scripts/053_schedule_adjustment_rollback.sql):
--   begin;
--   drop table if exists public.class_schedule_adjustment_events;
--   drop table if exists public.class_session_student_snapshots;
--   drop table if exists public.class_session_staff_snapshots;
--   drop table if exists public.class_session_exceptions;
--   drop table if exists public.class_schedule_adjustments;
--   drop function if exists public.block_class_schedule_adjustment_event_mutation();
--   alter table public.classes drop constraint if exists classes_operational_end_date_check;
--   drop index if exists classes_operational_end_idx;
--   alter table public.classes drop column if exists operational_end_date;
--   commit;
