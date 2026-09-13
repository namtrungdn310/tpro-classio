-- PERF SCALE DATASET — Round 8 performance benchmark (disposable DB only).
--
-- Creates the P3-mandated scale: 1,000 classes, 200 staff, 5,000 students,
-- 50,000+ fee records, with realistic lifecycle distribution and enough
-- relational schedule-slot / fee / enrollment data to exercise the Round 8
-- projection indexes (078).  Domain-valid only: never disables triggers or RLS
-- to force rows in.
--
-- Constraint contract observed:
--   - non-LEGACY classes need identity_scheme + dates in the past/future as the
--     lifecycle trigger requires; end_date >= start_date + 1 and start_date can
--     be in the past for already-started classes.
--   - enrollments need a valid class date range and unique (student, class)
--     while active.
--   - fee_records: period 'YYYY-MM'; UNPAID rows have no paid/notified fields;
--     PAID rows need paid_amount = final_amount, paid_date set, plus a matching
--     append-only payments ledger row.
--   - student_code is issued by the DB trigger on insert (do not set it).
--   - relational schedule slots (059) are created via class_schedule_slots +
--     class_schedule_slot_staff for availability to exercise the joined read.

do $$
declare
  i int;
  j int;
  staff_total int := 0;
  class_total int := 0;
  student_total int := 0;
  fee_total int := 0;
  v_class_id uuid;
  v_student_id uuid;
  v_enrollment_id uuid;
  v_record_id uuid;
  v_teacher1 uuid;
  v_teacher2 uuid;
  v_assistant uuid;
  v_staff_type text;
  v_is_historical boolean;
  v_is_scheduled boolean;
  v_is_cancelled boolean;
  v_is_completed boolean;
  v_identity text;
  v_start date;
  v_end date;
  v_due date;
  v_base_fee numeric;
  v_cycle_no int;
  v_business_date date := date '2026-08-18';
  staff_ids uuid[] := '{}';
  teacher_ids uuid[] := '{}';
  assistant_ids uuid[] := '{}';
  v_slot_id uuid;
  v_day text;
  v_time_start time;
  v_time_end time;
  v_scheme text;
  v_category text;
  v_grade int;
  v_acad_year int;
  v_name text;
  v_weekday int;
  v_status text;
begin
  -- =========================================================================
  -- STAFF: 150 teachers + 50 assistants = 200 (IDs collected for scheduling)
  -- =========================================================================
  for i in 1..200 loop
    if i <= 150 then
      v_staff_type := 'TEACHER';
    else
      v_staff_type := 'ASSISTANT';
    end if;
    v_teacher1 := gen_random_uuid();
    staff_ids := array_append(staff_ids, v_teacher1);
    if v_staff_type = 'TEACHER' then
      teacher_ids := array_append(teacher_ids, v_teacher1);
    else
      assistant_ids := array_append(assistant_ids, v_teacher1);
    end if;
    insert into public.staff_members (id, full_name, staff_type, zalo_name, phone, is_active)
    values (
      v_teacher1,
      'PerfGV ' || lpad(i::text, 3, '0'),
      v_staff_type,
      'perf-' || lpad(i::text, 3, '0'),
      '09' || lpad(((i * 7919) % 90000000)::text, 8, '0'),
      true
    );
    staff_total := staff_total + 1;
  end loop;

  -- =========================================================================
  -- CLASSES: 1,000 with lifecycle distribution
  --  650 active (operational), 100 scheduled, 150 completed, 100 cancelled.
  --  >=80% non-LEGACY (ACADEMIC_YEAR or INTAKE); small LEGACY slice retained.
  -- =========================================================================
  for i in 1..1000 loop
    v_class_id := gen_random_uuid();
    v_is_historical := i > 750;                 -- completed 751..900, cancelled 901..1000
    v_is_scheduled := i > 650 and i <= 750;     -- scheduled 651..750
    v_is_cancelled := i > 900;                  -- cancelled 901..1000
    v_is_completed := i > 750 and i <= 900;     -- completed 751..900

    -- Identity scheme.  Non-LEGACY classes cannot be backdated on INSERT
    -- (044 lifecycle trigger forbids start_date before the business date), so
    -- the scale fixture keeps completed/cancelled classes as LEGACY
    -- historical rows — exactly how production carries pre-identity history.
    -- Active + scheduled classes are canonical (the 078 scope index target).
    if v_is_historical or v_is_cancelled then
      v_scheme := 'LEGACY';
      v_category := null;
      v_grade := null;
      v_acad_year := null;
    elsif i % 10 = 5 then
      v_scheme := 'INTAKE';
      v_category := 'IELTS';
      v_grade := null;
      v_acad_year := null;
    else
      v_scheme := 'ACADEMIC_YEAR';
      v_category := case i % 3 when 0 then 'GENERAL' when 1 then 'SPECIALIZED' else 'CUSTOM' end;
      -- GENERAL/SPECIALIZED use GRADE mode with a grade; CUSTOM uses NONE and
      -- no grade (classes_category_shape_check).
      if v_category = 'CUSTOM' then
        v_grade := null;
      else
        v_grade := 1 + (i % 12);
      end if;
      v_acad_year := 2026;
    end if;

    -- Dates relative to business date.  Non-LEGACY (canonical) classes cannot
    -- be backdated on INSERT (044 trigger requires start_date >= business
    -- date), so active classes start at/after 2026-08-18 and run into 2027;
    -- the EXPLAIN reference date is set in the future to sit inside the active
    -- window.  LEGACY (completed/cancelled) classes may carry past dates.
    if v_is_historical then
      v_start := date '2025-01-01' + ((i * 3) % 180);
      v_end := v_start + 365;
    elsif v_is_scheduled then
      v_start := date '2026-11-01' + ((i * 2) % 90);
      v_end := v_start + 365;
    elsif v_is_cancelled then
      v_start := date '2026-01-01' + ((i * 5) % 150);
      v_end := v_start + 120;
    else
      -- active (operational): start at/after business date, run into 2027.
      v_start := date '2026-08-18' + ((i * 7) % 14);
      v_end := v_start + 240;
    end if;

    v_name := 'PerfLop ' || i;
    v_base_fee := 500000 + ((i * 250000) % 1500000);

    insert into public.classes (
      id, name, type, base_fee, billing_cycle_months, billing_cycle_weeks,
      teacher_id, identity_scheme, class_category, grade_mode, grade_level,
      education_level, academic_year_start, program_name, is_active, schedule,
      start_date, end_date, cancelled_at, completed_at, created_at
    ) values (
      v_class_id, v_name, 'MONTHLY'::public.class_type, v_base_fee, 1, null,
      null,
      v_scheme::public.class_identity_scheme,
      case when v_scheme = 'INTAKE' then 'IELTS' else v_category end::public.class_category,
      case
        when v_scheme = 'ACADEMIC_YEAR' and v_category in ('GENERAL','SPECIALIZED') then 'GRADE'::public.class_grade_mode
        when v_scheme = 'ACADEMIC_YEAR' and v_category = 'CUSTOM' then 'NONE'::public.class_grade_mode
        when v_scheme = 'INTAKE' then 'NONE'::public.class_grade_mode
        else null
      end,
      v_grade,
      case when v_grade between 1 and 5 then 'PRIMARY' when v_grade between 6 and 9 then 'MIDDLE' when v_grade between 10 and 12 then 'HIGH' else null end,
      v_acad_year,
      null,
      not (v_is_cancelled),
      jsonb_build_object('text', 'Thứ 2 (18:00-19:30)'),
      v_start, v_end,
      case when v_is_cancelled then now() - interval '2 days' else null end,
      case when v_is_completed then now() - interval '1 day' else null end,
      now() - interval '1 day' - (i % 90 || ' days')::interval
    );

    -- Lifecycle events for canonical classes (business evidence).
    if v_scheme <> 'LEGACY' then
      insert into public.class_lifecycle_events
        (class_id, event_type, previous_end_date, next_end_date, reason,
         actor_user_id, request_id, business_date, occurred_at)
      values
        (v_class_id, 'created', null, v_end,
         'Perf benchmark class created',
         null, gen_random_uuid(), v_business_date, now() - interval '1 day'),
        (v_class_id, 'identity_configured', null, v_end,
         'Perf benchmark identity configured',
         null, gen_random_uuid(), v_business_date, now() - interval '1 day');
      if v_is_completed then
        insert into public.class_lifecycle_events
          (class_id, event_type, previous_end_date, next_end_date, reason,
           actor_user_id, request_id, business_date, occurred_at)
        values
          (v_class_id, 'completed', v_end, null,
           'Perf benchmark class completed',
           null, gen_random_uuid(), v_business_date, now() - interval '1 day');
      end if;
      if v_is_cancelled then
        insert into public.class_lifecycle_events
          (class_id, event_type, previous_end_date, next_end_date, reason,
           actor_user_id, request_id, business_date, occurred_at)
        values
          (v_class_id, 'cancelled', v_end, null,
           'Perf benchmark class cancelled',
           null, gen_random_uuid(), v_business_date, now() - interval '1 day');
      end if;
    end if;

    -- Assign 1-3 teachers + 1 assistant to class_teachers junction.
    v_teacher1 := teacher_ids[1 + (i % 150)];
    v_teacher2 := teacher_ids[1 + ((i * 7 + 3) % 150)];
    v_assistant := assistant_ids[1 + (i % 50)];
    insert into public.class_teachers (class_id, teacher_id) values (v_class_id, v_teacher1);
    if i % 3 = 0 then
      insert into public.class_teachers (class_id, teacher_id) values (v_class_id, v_teacher2);
    end if;
    if i % 2 = 0 then
      insert into public.class_teachers (class_id, teacher_id) values (v_class_id, v_assistant);
    end if;

    -- Relational schedule slots (059) — 1-4 slots per class for availability.
    for j in 1..(1 + (i % 4)) loop
      v_slot_id := gen_random_uuid();
      v_weekday := (i + j) % 7;
      v_day := case v_weekday
        when 0 then 'Thứ 2' when 1 then 'Thứ 3' when 2 then 'Thứ 4'
        when 3 then 'Thứ 5' when 4 then 'Thứ 6' when 5 then 'Thứ 7'
        else 'Chủ Nhật' end;
      v_time_start := make_time(7 + ((i + j * 3) % 10), ((i + j * 7) % 2) * 30, 0);
      v_time_end := v_time_start + interval '90 minutes';
      insert into public.class_schedule_slots (
        id, class_id, weekday, local_start, local_end, timezone, version,
        effective_from, effective_until, created_at, updated_at
      ) values (
        v_slot_id, v_class_id, v_day::public.class_day, v_time_start, v_time_end,
        'Asia/Ho_Chi_Minh', 1, v_start, null, now(), now()
      );
      insert into public.class_schedule_slot_staff (slot_id, staff_id, role)
      values (v_slot_id, v_teacher1, 'TEACHER');
      if i % 3 = 0 then
        insert into public.class_schedule_slot_staff (slot_id, staff_id, role)
        values (v_slot_id, v_teacher2, 'TEACHER');
      end if;
      if i % 2 = 0 then
        insert into public.class_schedule_slot_staff (slot_id, staff_id, role)
        values (v_slot_id, v_assistant, 'ASSISTANT');
      end if;
    end loop;

    class_total := class_total + 1;
  end loop;

  -- =========================================================================
  -- STUDENTS: 5,000 profiles (status active/inactive/archived distribution)
  -- =========================================================================
  for i in 1..5000 loop
    v_student_id := gen_random_uuid();
    insert into public.students (
      id, full_name, parent_name, parent_phone, student_phone, school, status,
      archived_at, archived_by, archived_reason
    )
    values (
      v_student_id,
      'PerfHV ' || lpad(i::text, 4, '0'),
      'Phụ huynh ' || i,
      '09' || lpad(((i::bigint * 104729) % 90000000)::text, 8, '0'),
      '09' || lpad(((i::bigint * 524287) % 90000000)::text, 8, '0'),
      'Perf Trường ' || (i % 40),
      case
        when i % 100 = 0 then 'archived'::public.student_status
        when i % 50 = 0 then 'inactive'::public.student_status
        else 'active'::public.student_status
      end,
      case when i % 100 = 0 then now() else null end,
      null,
      case when i % 100 = 0 then 'Perf benchmark archive' else null end
    );
    student_total := student_total + 1;
  end loop;

  -- =========================================================================
  -- ENROLLMENTS + FEE RECORDS: >= 50,000 cycles across active classes.
  --   Each active student is enrolled in 1..3 classes; each enrollment gets a
  --   run of cycles (UNPAID/PAID/NOTIFIED/VOID/SUPERSEDED with varying due
  --   dates), with a matching payments ledger row for PAID records.
  -- =========================================================================
  for i in 1..5000 loop
    -- Skip archived/inactive students for enrollment (keeps integrity simple).
    if i % 100 = 0 or i % 50 = 0 then
      continue;
    end if;

    select id into v_student_id
      from public.students
     where full_name = 'PerfHV ' || lpad(i::text, 4, '0');

    for j in 1..(1 + (i % 3)) loop
      -- Assign to an active/operational class. Deterministic offset spreads
      -- enrollments across the 500 canonical active classes without duplicating
      -- the (student,class) active pair (j <= 3 classes per student).
      v_class_id := null;
      select id, base_fee, start_date, end_date
        into v_class_id, v_base_fee, v_start, v_end
        from public.classes
       where identity_scheme <> 'LEGACY'
         and cancelled_at is null
         and completed_at is null
       order by id
       limit 1 offset ((i + j * 101) % 500);

      v_enrollment_id := gen_random_uuid();
      insert into public.enrollments (
        id, student_id, class_id, enrollment_date, custom_fee, status, created_at
      ) values (
        v_enrollment_id, v_student_id, v_class_id,
        greatest(v_start, date '2026-01-10'), null, 'active', now()
      );

      -- Generate a run of 3..12 fee cycles (UNPAID/PAID/terminal mix).
      for v_cycle_no in 0..(2 + (i % 10)) loop
        v_record_id := gen_random_uuid();
        v_due := (date '2026-01-10') + (v_cycle_no * 30)::int + (i % 3);
        v_status := case
          when v_cycle_no = 0 then 'UNPAID'
          when (i + v_cycle_no) % 9 = 0 then 'VOID'
          when (i + v_cycle_no) % 7 = 0 then 'SUPERSEDED'
          when (i + v_cycle_no) % 3 = 0 then 'PAID'
          else 'UNPAID'
        end;

        insert into public.fee_records (
          id, enrollment_id, period, due_date, base_due_date, adjusted_due_date,
          coverage_start, coverage_end, cycle_no, origin,
          enrollment_date_snapshot, student_name_snapshot, class_name_snapshot,
          class_type_snapshot, billing_cycle_months_snapshot,
          billing_cycle_weeks_snapshot, base_amount, discount_amount,
          status, notified_at, notification_channel,
          notification_message, paid_amount, paid_date, refunded_amount,
          voided_at, superseded_by_record_id, superseded_at, created_at, updated_at
        ) values (
          v_record_id, v_enrollment_id, to_char(v_due, 'YYYY-MM'), v_due,
          v_due, v_due, v_due, v_due + 30, v_cycle_no,
          case when v_cycle_no = 0 then 'cycle0' else 'renewal' end,
          date '2026-01-10',
          (select full_name from public.students where id = v_student_id),
          (select name from public.classes where id = v_class_id),
          'MONTHLY'::public.class_type, 1, null, v_base_fee, 0,
          v_status::public.fee_status,
          case when v_status = 'PAID' then now() else null end,
          case when v_status = 'PAID' then 'zalo_manual' else null end,
          case when v_status = 'PAID' then 'Perf benchmark fee notified' else null end,
          case when v_status = 'PAID' then v_base_fee else null end,
          case when v_status = 'PAID' then v_due else null end,
          0,
          case when v_status in ('VOID','SUPERSEDED') then now() else null end,
          null, null, now(), now()
        );

        -- Matching append-only payments ledger row for PAID records.
        if v_status = 'PAID' then
          insert into public.payments (
            fee_record_id, amount, payment_date, payment_method, note, created_at
          ) values (
            v_record_id, v_base_fee, v_due, 'bank_transfer',
            'Perf benchmark payment', now()
          );
        end if;

        fee_total := fee_total + 1;
      end loop;
    end loop;
  end loop;

  raise notice 'PerfScale: staff=%, classes=%, students=%, fee_records=%',
    staff_total, class_total, student_total, fee_total;
end;
$$;
