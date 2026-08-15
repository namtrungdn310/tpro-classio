-- R6-D05 056 fixture: legacy fee records across multiple months + one
-- null-due legacy record (like the 053 fixture pattern) + a dropped
-- enrollment record.
\set ON_ERROR_STOP on

-- Keep this fixture self-contained when CI runs the numeric migration chain.
-- The disposable multi-scenario runner already has the M053 class/staff, so
-- these inserts are no-ops there.  The class carries a canonical JSON slot;
-- migration 059 will materialize it and migration 062 can safely backfill the
-- active enrollment's ALL-slot selection instead of aborting on a schedule-less
-- synthetic class.
insert into public.staff_members (id, full_name, staff_type, is_active, zalo_name, phone)
values (
  '10000000-0000-0000-0000-000000000001', 'M056 Teacher', 'TEACHER', true,
  'm056-teacher', '0900000056'
)
on conflict (id) do nothing;

insert into public.classes (
  id, name, type, base_fee, billing_cycle_months, teacher_id,
  identity_scheme, start_date, end_date, is_active, schedule
)
values (
  '50000000-0000-0000-0000-000000000001', 'Lớp M053 A', 'MONTHLY', 750000, 1,
  '10000000-0000-0000-0000-000000000001', 'LEGACY',
  date '2026-09-01', date '2027-05-31', true,
  '{"text":"Thứ 2 (18:00-19:30)","slots":[
     {"day":"Thứ 2","start":"18:00","end":"19:30",
      "teacher_ids":["10000000-0000-0000-0000-000000000001"],
      "assistant_ids":[]}
   ]}'::jsonb
)
on conflict (id) do nothing;

insert into public.class_teachers (class_id, teacher_id)
values (
  '50000000-0000-0000-0000-000000000001',
  '10000000-0000-0000-0000-000000000001'
)
on conflict do nothing;

insert into public.students (id, full_name, status)
select '60000000-0000-0000-0000-000000000011', 'M056 Student X', 'active'
where not exists (
  select 1 from public.students where id = '60000000-0000-0000-0000-000000000011'
);
insert into public.students (id, full_name, status)
select '60000000-0000-0000-0000-000000000012', 'M056 Student Y', 'active'
where not exists (
  select 1 from public.students where id = '60000000-0000-0000-0000-000000000012'
);

insert into public.enrollments (id, student_id, class_id, enrollment_date, status)
values (
  '70000000-0000-0000-0000-000000000011', '60000000-0000-0000-0000-000000000011',
  '50000000-0000-0000-0000-000000000001', '2026-09-01', 'active'
)
on conflict (id) do nothing;

insert into public.enrollments (id, student_id, class_id, enrollment_date, status)
values (
  '70000000-0000-0000-0000-000000000012', '60000000-0000-0000-0000-000000000012',
  '50000000-0000-0000-0000-000000000001', '2026-09-10', 'dropped'
)
on conflict (id) do nothing;

-- Chuỗi 3 kỳ theo evidence due_date; kỳ giữa đã nộp (protected).
insert into public.fee_records (
  enrollment_id, period, due_date, base_amount, discount_amount, status,
  paid_amount, paid_date, notified_at, notification_channel, notification_message,
  enrollment_date_snapshot, student_name_snapshot, class_name_snapshot,
  class_type_snapshot, billing_cycle_months_snapshot
)
values
  ('70000000-0000-0000-0000-000000000011', '2026-10', '2026-10-01', 750000, 0,
   'UNPAID', null, null, null, null, null, '2026-09-01', 'M056 Student X',
   'Lớp M053 A', 'MONTHLY', 1),
  ('70000000-0000-0000-0000-000000000011', '2026-11', '2026-11-01', 750000, 0,
   'PAID', 750000, '2026-11-01', '2026-11-01T02:00:00+00:00', 'zalo_manual',
   'Thông báo kỳ 2', '2026-09-01', 'M056 Student X', 'Lớp M053 A', 'MONTHLY', 1),
  ('70000000-0000-0000-0000-000000000011', '2026-12', '2026-12-01', 750000, 0,
   'UNPAID', null, null, null, null, null, '2026-09-01', 'M056 Student X',
   'Lớp M053 A', 'MONTHLY', 1),
  -- null due (053-style) cho enrollment dropped.
  ('70000000-0000-0000-0000-000000000012', '2026-09', null, 500000, 0,
   'UNPAID', null, null, null, null, null, '2026-09-10', 'M056 Student Y',
   'Lớp M053 A', 'MONTHLY', 1)
on conflict (enrollment_id, period) do nothing;
