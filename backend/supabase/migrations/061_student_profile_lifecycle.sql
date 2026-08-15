-- R6-D08 — Student profile lifecycle: FK RESTRICT + archive columns + indexes.
--
-- No FK/CASCADE may delete finance, payment, operation, attendance or
-- history when a class, enrollment or auth account changes (goal.md §2).
-- Archive is explicit (actor/reason) and preserves the student_code registry.

begin;

-- ===========================================================================
-- 1. FK RESTRICT (drop CASCADE, re-add RESTRICT)
-- ===========================================================================
do $$
declare
  fk record;
begin
  for fk in
    select conname
      from pg_constraint
     where contype = 'f'
       and conrelid = 'public.enrollments'::regclass
       and confrelid = 'public.students'::regclass
  loop
    execute format('alter table public.enrollments drop constraint %I', fk.conname);
  end loop;
  for fk in
    select conname
      from pg_constraint
     where contype = 'f'
       and conrelid = 'public.enrollments'::regclass
       and confrelid = 'public.classes'::regclass
  loop
    execute format('alter table public.enrollments drop constraint %I', fk.conname);
  end loop;
  for fk in
    select conname
      from pg_constraint
     where contype = 'f'
       and conrelid = 'public.fee_records'::regclass
       and confrelid = 'public.enrollments'::regclass
  loop
    execute format('alter table public.fee_records drop constraint %I', fk.conname);
  end loop;
  for fk in
    select conname
      from pg_constraint
     where contype = 'f'
       and conrelid = 'public.payments'::regclass
       and confrelid = 'public.fee_records'::regclass
  loop
    execute format('alter table public.payments drop constraint %I', fk.conname);
  end loop;
end;
$$;

alter table public.enrollments
  add constraint enrollments_student_id_fkey
    foreign key (student_id) references public.students(id) on delete restrict;
alter table public.enrollments
  add constraint enrollments_class_id_fkey
    foreign key (class_id) references public.classes(id) on delete restrict;
alter table public.fee_records
  add constraint fee_records_enrollment_id_fkey
    foreign key (enrollment_id) references public.enrollments(id) on delete restrict;
alter table public.payments
  add constraint payments_fee_record_id_fkey
    foreign key (fee_record_id) references public.fee_records(id) on delete restrict;

-- ===========================================================================
-- 2. Explicit archive metadata
-- ===========================================================================
alter table public.students
  add column if not exists archived_at timestamptz;
alter table public.students
  add column if not exists archived_by uuid
  references public.profiles(id) on delete set null;
alter table public.students
  add column if not exists archived_reason text;

alter table public.students
  drop constraint if exists students_archive_metadata_check;
alter table public.students
  add constraint students_archive_metadata_check
    check (
      status <> 'archived'
      or (archived_at is not null and archived_reason is not null)
    ) not valid;
alter table public.students
  validate constraint students_archive_metadata_check;

-- Lifecycle events mở rộng cho archive/restore.
alter table public.student_lifecycle_events
  drop constraint if exists student_lifecycle_events_action_check;
alter table public.student_lifecycle_events
  add constraint student_lifecycle_events_action_check
    check (
      action = any (array[
        'student_deactivated', 'student_reactivated',
        'existing_student_enrolled', 'duplicate_candidate_overridden',
        'student_archived', 'student_restored'
      ])
    ) not valid;
alter table public.student_lifecycle_events
  validate constraint student_lifecycle_events_action_check;

alter table public.student_lifecycle_events
  drop constraint if exists student_lifecycle_events_next_status_check;
alter table public.student_lifecycle_events
  add constraint student_lifecycle_events_next_status_check
    check (next_status is null or next_status in ('active', 'inactive', 'archived'))
    not valid;
alter table public.student_lifecycle_events
  validate constraint student_lifecycle_events_next_status_check;

alter table public.student_lifecycle_events
  drop constraint if exists student_lifecycle_events_previous_status_check;
alter table public.student_lifecycle_events
  add constraint student_lifecycle_events_previous_status_check
    check (previous_status is null or previous_status in ('active', 'inactive', 'archived'))
    not valid;
alter table public.student_lifecycle_events
  validate constraint student_lifecycle_events_previous_status_check;

-- ===========================================================================
-- 3. Search indexes (server-side, indexed; student_code exact/prefix)
-- ===========================================================================
drop index if exists students_student_code_search_idx;
create index students_student_code_search_idx
  on public.students (student_code text_pattern_ops)
  where student_code is not null;

drop index if exists students_full_name_norm_search_idx;
create index students_full_name_norm_search_idx
  on public.students (lower(full_name) text_pattern_ops);

drop index if exists students_parent_phone_search_idx;
create index students_parent_phone_search_idx
  on public.students (regexp_replace(coalesce(parent_phone, ''), '\D', '', 'g'));

-- ===========================================================================
-- 4. Acceptance
-- ===========================================================================
do $$
declare
  cascade_left bigint;
begin
  select count(*) into cascade_left
    from pg_constraint
   where contype = 'f'
     and confdeltype = 'c'
     and conname in (
       'enrollments_student_id_fkey',
       'enrollments_class_id_fkey',
       'fee_records_enrollment_id_fkey',
       'payments_fee_record_id_fkey'
     );
  if cascade_left > 0 then
    raise exception 'M061 acceptance failed: % destructive CASCADE FK(s) remain', cascade_left;
  end if;
  raise notice 'M061 acceptance OK: no destructive CASCADE remains';
end;
$$;

commit;
