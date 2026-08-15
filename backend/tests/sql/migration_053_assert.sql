-- Assertions sau khi chạy 053 trên fixture (upgrade DB).
-- Mọi probe ghi dữ liệu nằm trong subtransaction + sentinel rollback (P9100)
-- nên assert không để lại dữ liệu — rollback/reapply scenario giữ nguyên sạch.

do $$
declare
  probe_adjustment_id uuid;
  probe_exception_id uuid;
  probe_event_id uuid;
  probe_staff_snapshot_id uuid;
  probe_student_snapshot_id uuid;
begin
  -- ------------------------------------------------------------------
  -- 1. operational_end_date backfill
  -- ------------------------------------------------------------------
  if (
    select operational_end_date
      from public.classes
     where id = '50000000-0000-0000-0000-000000000001'
  ) <> date '2027-05-31' then
    raise exception 'M053 assert: class A operational_end_date must backfill to end_date';
  end if;
  if (
    select operational_end_date
      from public.classes
     where id = '50000000-0000-0000-0000-000000000002'
  ) <> date '2027-05-31' then
    raise exception 'M053 assert: class B operational_end_date must backfill to end_date';
  end if;
  if (
    select operational_end_date
      from public.classes
     where id = '50000000-0000-0000-0000-000000000003'
  ) is not null then
    raise exception 'M053 assert: LEGACY class must keep operational_end_date NULL';
  end if;
  if exists (
    select 1
      from public.classes
     where identity_scheme = 'LEGACY'
       and operational_end_date is not null
  ) then
    raise exception 'M053 assert: no LEGACY class may have operational_end_date';
  end if;

  -- ------------------------------------------------------------------
  -- 2. Constraints / indexes / RLS / ACL
  -- ------------------------------------------------------------------
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.classes'::regclass
       and conname = 'classes_operational_end_date_check'
       and contype = 'c' and convalidated
  ) then
    raise exception 'M053 assert: classes_operational_end_date_check missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.class_session_exceptions'::regclass
       and conname = 'class_session_exceptions_replacement_duration_check'
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = 'public.class_session_exceptions'::regclass
       and conname = 'class_session_exceptions_state_shape_check'
  ) or not exists (
    select 1 from pg_constraint
     where conrelid = 'public.class_session_exceptions'::regclass
       and conname = 'class_session_exceptions_replacement_after_original_check'
  ) then
    raise exception 'M053 assert: exception state/duration constraints missing';
  end if;
  if to_regclass('public.ux_class_session_exceptions_active_original') is null
     or to_regclass('public.ux_class_session_exceptions_completed_original') is null
     or to_regclass('public.ux_class_session_staff_snapshots') is null
     or to_regclass('public.ux_class_session_student_snapshots') is null
     or to_regclass('public.ux_class_schedule_adjustments_request') is null then
    raise exception 'M053 assert: partial unique indexes missing';
  end if;

  if exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname in (
         'class_schedule_adjustments', 'class_session_exceptions',
         'class_session_staff_snapshots', 'class_session_student_snapshots',
         'class_schedule_adjustment_events'
       )
       and (not c.relrowsecurity or not c.relforcerowsecurity)
  ) then
    raise exception 'M053 assert: new tables must enable and force RLS';
  end if;
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename in (
         'class_schedule_adjustments', 'class_session_exceptions',
         'class_session_staff_snapshots', 'class_session_student_snapshots',
         'class_schedule_adjustment_events'
       )
  ) then
    raise exception 'M053 assert: new tables must have zero policies';
  end if;
  if has_table_privilege('anon', 'public.class_session_exceptions', 'select')
     or has_table_privilege('authenticated', 'public.class_session_exceptions', 'select')
     or has_table_privilege('anon', 'public.class_schedule_adjustment_events', 'select')
     or has_table_privilege('authenticated', 'public.class_schedule_adjustment_events', 'select')
     or has_table_privilege('anon', 'public.class_schedule_adjustments', 'insert')
     or has_table_privilege('authenticated', 'public.class_session_staff_snapshots', 'insert')
  then
    raise exception 'M053 assert: browser roles must not access new tables';
  end if;
  if not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.class_schedule_adjustment_events'::regclass
       and t.tgname = 'trg_class_schedule_adjustment_events_append_only'
       and not t.tgisinternal and t.tgenabled <> 'D'
  ) or not exists (
    select 1
      from pg_trigger t
     where t.tgrelid = 'public.class_schedule_adjustment_events'::regclass
       and t.tgname = 'trg_class_schedule_adjustment_events_truncate'
       and not t.tgisinternal and t.tgenabled <> 'D'
  ) then
    raise exception 'M053 assert: adjustment events must be append-only';
  end if;

  -- ------------------------------------------------------------------
  -- 3. Probe ghi dữ liệu hợp lệ (rollback bằng sentinel P9100)
  -- ------------------------------------------------------------------
  begin
    insert into public.class_schedule_adjustments (
      id, class_id, reason_code, reason_note, affected_from, affected_through,
      status, created_by, request_id
    ) values (
      '80000000-0000-0000-0000-000000000001',
      '50000000-0000-0000-0000-000000000001',
      'TEACHER_UNAVAILABLE', 'Giáo viên bận việc đột xuất',
      '2026-09-07', '2026-09-07', 'OPEN',
      '10000000-0000-0000-0000-000000000001',
      '80000000-0000-0000-0000-000000000101'
    ) returning id into probe_adjustment_id;

    insert into public.class_session_exceptions (
      id, adjustment_id, class_id,
      original_start_at, original_end_at, original_timezone, status
    ) values (
      '80000000-0000-0000-0000-000000000002',
      probe_adjustment_id,
      '50000000-0000-0000-0000-000000000001',
      '2026-09-07T11:00:00+00:00',
      '2026-09-07T12:30:00+00:00',
      'Asia/Ho_Chi_Minh', 'MAKEUP_PENDING'
    ) returning id into probe_exception_id;

    insert into public.class_session_staff_snapshots (
      id, exception_id, staff_id, role, display_name_snapshot, source_slot_key
    ) values (
      '80000000-0000-0000-0000-000000000003',
      probe_exception_id,
      '10000000-0000-0000-0000-000000000001',
      'TEACHER', 'Cô Hạnh', 'Thứ 2|18:00|19:30'
    ) returning id into probe_staff_snapshot_id;

    insert into public.class_session_student_snapshots (
      id, exception_id, student_id, enrollment_id, student_name_snapshot,
      enrolled_at_snapshot, enrollment_end_snapshot, eligibility_status
    ) values (
      '80000000-0000-0000-0000-000000000004',
      probe_exception_id,
      '60000000-0000-0000-0000-000000000001',
      '70000000-0000-0000-0000-000000000001',
      'Nguyễn Văn An', '2026-09-01', null, 'ELIGIBLE'
    ) returning id into probe_student_snapshot_id;

    insert into public.class_schedule_adjustment_events (
      id, exception_id, event_type, old_payload, new_payload,
      actor_user_id, request_id
    ) values (
      '80000000-0000-0000-0000-000000000005',
      probe_exception_id, 'postponed',
      null, '{"status": "MAKEUP_PENDING"}'::jsonb,
      null, '80000000-0000-0000-0000-000000000101'
    ) returning id into probe_event_id;

    if probe_adjustment_id is null or probe_exception_id is null
       or probe_staff_snapshot_id is null or probe_student_snapshot_id is null
       or probe_event_id is null then
      raise exception 'M053 assert: valid probe insert failed';
    end if;

    -- 3a. duplicate active exception (cùng class + original) phải bị chặn
    begin
      insert into public.class_session_exceptions (
        adjustment_id, class_id, original_start_at, original_end_at, status
      ) values (
        probe_adjustment_id,
        '50000000-0000-0000-0000-000000000001',
        '2026-09-07T11:00:00+00:00',
        '2026-09-07T12:30:00+00:00',
        'MAKEUP_PENDING'
      );
      raise exception 'M053 assert: duplicate active exception accepted'
        using errcode = 'P9101';
    exception
      when sqlstate 'P9101' then raise;
      when unique_violation then null;
    end;

    -- 3b. duration mismatch phải bị chặn
    begin
      insert into public.class_session_exceptions (
        adjustment_id, class_id, original_start_at, original_end_at, status,
        replacement_start_at, replacement_end_at
      ) values (
        probe_adjustment_id,
        '50000000-0000-0000-0000-000000000001',
        '2026-09-14T11:00:00+00:00',
        '2026-09-14T12:30:00+00:00',
        'MAKEUP_SCHEDULED',
        '2026-09-21T11:00:00+00:00',
        '2026-09-21T11:30:00+00:00'
      );
      raise exception 'M053 assert: duration mismatch accepted'
        using errcode = 'P9102';
    exception
      when sqlstate 'P9102' then raise;
      when check_violation then null;
    end;

    -- 3c. replacement trước original phải bị chặn
    begin
      insert into public.class_session_exceptions (
        adjustment_id, class_id, original_start_at, original_end_at, status,
        replacement_start_at, replacement_end_at
      ) values (
        probe_adjustment_id,
        '50000000-0000-0000-0000-000000000001',
        '2026-09-14T11:00:00+00:00',
        '2026-09-14T12:30:00+00:00',
        'MAKEUP_SCHEDULED',
        '2026-09-10T11:00:00+00:00',
        '2026-09-10T12:30:00+00:00'
      );
      raise exception 'M053 assert: replacement before original accepted'
        using errcode = 'P9103';
    exception
      when sqlstate 'P9103' then raise;
      when check_violation then null;
    end;

    -- 3d. state shape sai (SCHEDULED không có replacement) phải bị chặn
    begin
      insert into public.class_session_exceptions (
        adjustment_id, class_id, original_start_at, original_end_at, status
      ) values (
        probe_adjustment_id,
        '50000000-0000-0000-0000-000000000001',
        '2026-09-14T11:00:00+00:00',
        '2026-09-14T12:30:00+00:00',
        'MAKEUP_SCHEDULED'
      );
      raise exception 'M053 assert: invalid state shape accepted'
        using errcode = 'P9104';
    exception
      when sqlstate 'P9104' then raise;
      when check_violation then null;
    end;

    -- 3e. operational_end_date < end_date phải bị chặn
    begin
      update public.classes
         set operational_end_date = '2026-08-01'
       where id = '50000000-0000-0000-0000-000000000001';
      raise exception 'M053 assert: operational_end_date < end_date accepted'
        using errcode = 'P9105';
    exception
      when sqlstate 'P9105' then raise;
      when check_violation then null;
    end;

    -- 3f. event update/delete/truncate phải bị chặn (append-only)
    begin
      update public.class_schedule_adjustment_events
         set new_payload = '{}'::jsonb
       where id = probe_event_id;
      raise exception 'M053 assert: event update accepted'
        using errcode = 'P9106';
    exception
      when sqlstate 'P9106' then raise;
      when insufficient_privilege then null;
    end;
    begin
      delete from public.class_schedule_adjustment_events
       where id = probe_event_id;
      raise exception 'M053 assert: event delete accepted'
        using errcode = 'P9107';
    exception
      when sqlstate 'P9107' then raise;
      when insufficient_privilege then null;
    end;
    begin
      truncate table public.class_schedule_adjustment_events;
      raise exception 'M053 assert: event truncate accepted'
        using errcode = 'P9108';
    exception
      when sqlstate 'P9108' then raise;
      when insufficient_privilege then null;
    end;

    raise exception 'rollback successful M053 data probes'
      using errcode = 'P9100';
  exception
    when sqlstate 'P9100' then null;
  end;

  raise notice 'M053 fixture assertions OK';
end $$;
