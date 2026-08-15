-- Assertions trước khi rollback 053 (sau khi rollback — mọi object mới biến mất).
do $$
begin
  if to_regclass('public.class_schedule_adjustments') is not null
     or to_regclass('public.class_session_exceptions') is not null
     or to_regclass('public.class_session_staff_snapshots') is not null
     or to_regclass('public.class_session_student_snapshots') is not null
     or to_regclass('public.class_schedule_adjustment_events') is not null then
    raise exception 'M053 assert-before: new tables still exist after rollback';
  end if;
  if to_regprocedure('public.block_class_schedule_adjustment_event_mutation()') is not null then
    raise exception 'M053 assert-before: guard function still exists';
  end if;
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'classes'
       and column_name = 'operational_end_date'
  ) then
    raise exception 'M053 assert-before: operational_end_date still exists';
  end if;
  if to_regclass('public.classes_operational_end_idx') is not null then
    raise exception 'M053 assert-before: operational end index still exists';
  end if;
  raise notice 'M053 before-state assertions OK';
end $$;
