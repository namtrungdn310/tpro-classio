-- 120_student_lifecycle_event_reason.sql
-- Thêm cột reason cho student_lifecycle_events và backfill sự kiện student_archived gần nhất

begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

-- 1. Thêm cột nullable reason
alter table public.student_lifecycle_events
  add column if not exists reason text;

-- 2. Tạm thời tắt trigger append-only để backfill dữ liệu cho hồ sơ đang archived
alter table public.student_lifecycle_events
  disable trigger trg_student_lifecycle_events_append_only;

with latest_archived_events as (
  select distinct on (sle.student_id)
    sle.id as event_id,
    s.archived_reason as reason
  from public.student_lifecycle_events sle
  join public.students s on s.id = sle.student_id
  where s.status = 'archived'
    and s.archived_reason is not null
    and length(btrim(s.archived_reason)) >= 3
    and length(btrim(s.archived_reason)) <= 500
    and sle.action = 'student_archived'
  order by sle.student_id, sle.occurred_at desc, sle.id desc
)
update public.student_lifecycle_events sle
set reason = btrim(lae.reason)
from latest_archived_events lae
where sle.id = lae.event_id
  and sle.reason is null;

-- Bật lại trigger append-only
alter table public.student_lifecycle_events
  enable trigger trg_student_lifecycle_events_append_only;

-- 3. Thêm check constraint: null hoặc sau trim dài từ 3 đến 500 ký tự
alter table public.student_lifecycle_events
  drop constraint if exists student_lifecycle_events_reason_check;

alter table public.student_lifecycle_events
  add constraint student_lifecycle_events_reason_check
  check (
    reason is null or (
      length(btrim(reason)) >= 3 and length(btrim(reason)) <= 500
    )
  ) not valid;

alter table public.student_lifecycle_events
  validate constraint student_lifecycle_events_reason_check;

commit;
