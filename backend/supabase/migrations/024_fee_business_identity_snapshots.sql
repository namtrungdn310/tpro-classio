-- Keep historical fee reports stable when a student or class is renamed.
-- Draft rows may keep null snapshots; the backend freezes current identity at
-- the first notification and never rewrites protected history afterwards.
begin;


alter table public.fee_records
  add column if not exists student_name_snapshot text,
  add column if not exists class_name_snapshot text,
  add column if not exists class_type_snapshot class_type,
  add column if not exists billing_cycle_months_snapshot smallint;

update public.fee_records fr
set
  student_name_snapshot = coalesce(fr.student_name_snapshot, s.full_name),
  class_name_snapshot = coalesce(fr.class_name_snapshot, c.name),
  class_type_snapshot = coalesce(fr.class_type_snapshot, c.type),
  billing_cycle_months_snapshot = coalesce(
    fr.billing_cycle_months_snapshot,
    c.billing_cycle_months
  )
from public.enrollments e
join public.students s on s.id = e.student_id
join public.classes c on c.id = e.class_id
where fr.enrollment_id = e.id;

alter table public.fee_records
  drop constraint if exists fee_records_protected_identity_snapshot_check;

alter table public.fee_records
  add constraint fee_records_protected_identity_snapshot_check
  check (
    notified_at is null
    or (
      student_name_snapshot is not null
      and char_length(btrim(student_name_snapshot)) between 1 and 120
      and class_name_snapshot is not null
      and char_length(btrim(class_name_snapshot)) between 1 and 120
      and class_type_snapshot is not null
      and billing_cycle_months_snapshot between 1 and 12
    )
  ) not valid;

alter table public.fee_records
  validate constraint fee_records_protected_identity_snapshot_check;

commit;
