-- Explicitly approved metadata repair. Not a general backfill/migration.
-- Keep pending status, dates, student snapshots and every financial row intact.
begin;
set local lock_timeout = '5s';
set local statement_timeout = '30s';
do $$
declare
  x public.class_session_exceptions%rowtype;
  s public.class_schedule_slots%rowtype;
  repair_id constant uuid := '6b633756-b2e6-48a0-980c-541aacaf2433';
  candidates integer;
  staff_count integer;
begin
  select * into strict x from public.class_session_exceptions
    where id='aee80a5d-fbcd-4856-9735-e9f6a9f91cb6' for update;
  perform set_config('app.workspace_id', x.workspace_id::text, true);
  perform 1 from public.classes where id=x.class_id for update;
  if exists(select 1 from public.class_schedule_adjustment_events
      where exception_id=x.id and request_id=repair_id and event_type='correction-recorded') then
    if x.source_slot_id is null or not exists(select 1 from public.class_session_staff_snapshots
        where exception_id=x.id and role='TEACHER') then
      raise exception 'Replayed repair no longer matches its receipt';
    end if;
    return;
  end if;
  if x.status <> 'MAKEUP_PENDING' or x.source_slot_id is not null
    or x.replacement_start_at is not null or x.completed_at is not null
    or x.original_start_at <> '2026-09-07 10:00:00+00'::timestamptz
    or x.original_end_at <> '2026-09-07 11:30:00+00'::timestamptz
    or exists(select 1 from public.class_session_staff_snapshots where exception_id=x.id)
    then raise exception 'Source exception changed; stop repair'; end if;

  select count(*) into candidates from public.class_schedule_slots
    where class_id=x.class_id and workspace_id=x.workspace_id and weekday='Thứ 2'
      and local_start='17:00'::time and local_end='18:30'::time
      and timezone='Asia/Ho_Chi_Minh' and effective_from<='2026-09-07'
      and (effective_until is null or effective_until>'2026-09-07')
      and created_at<x.created_at and version=1;
  if candidates<>1 then raise exception 'Historical slot is not unique'; end if;
  select * into strict s from public.class_schedule_slots
    where id='1158b982-1776-5f17-8bf7-b436381a2f25' and class_id=x.class_id
      and workspace_id=x.workspace_id and weekday='Thứ 2'
      and local_start='17:00'::time and local_end='18:30'::time and version=1
    for update;
  perform 1 from public.class_schedule_slot_staff where slot_id=s.id for update;
  select count(*) into staff_count from public.class_schedule_slot_staff l
    where l.slot_id=s.id and l.workspace_id=x.workspace_id and l.created_at<x.created_at
      and ((l.role='TEACHER' and l.staff_id='b6a29078-ea95-555e-b458-c0cde6974eab')
        or (l.role='ASSISTANT' and l.staff_id='ca1806d8-73b8-57b2-969a-49b2048283f3'))
      and exists(select 1 from public.class_schedule_slot_staff_revisions r
        where r.slot_id=l.slot_id and r.staff_id=l.staff_id and r.role=l.role
          and r.workspace_id=x.workspace_id and r.effective_from<=x.original_start_at
          and (r.effective_until is null or r.effective_until>x.original_start_at));
  if staff_count<>2 or (select count(*) from public.class_schedule_slot_staff where slot_id=s.id)<>2
    or exists(select 1 from public.class_schedule_slot_teacher_events where slot_id=s.id)
    then raise exception 'Historical assignment evidence changed; stop repair'; end if;

  insert into public.class_session_staff_snapshots
    (exception_id,staff_id,role,display_name_snapshot,source_slot_key,source_slot_id,workspace_id)
    select x.id,l.staff_id,l.role,m.full_name,'Thứ 2|17:00|18:30',s.id,x.workspace_id
      from public.class_schedule_slot_staff l join public.staff_members m on m.id=l.staff_id
      where l.slot_id=s.id and m.workspace_id=x.workspace_id;
  get diagnostics staff_count = row_count;
  if staff_count<>2 then raise exception 'Staff source missing'; end if;
  update public.class_session_exceptions set source_slot_id=s.id,version=version+1,updated_at=now()
    where id=x.id;
  insert into public.class_schedule_adjustment_events
    (exception_id,event_type,old_payload,new_payload,actor_user_id,request_id,workspace_id)
    values(x.id,'correction-recorded',
      jsonb_build_object('source_slot_id',null,'staff_snapshot_count',0,'version',x.version),
      jsonb_build_object('source_slot_id',s.id,'staff_snapshot_count',2,'version',x.version+1,
        'reason','Approved maintenance: restore missing canonical metadata from unchanged slot and pre-existing staff links; pending status and finances preserved',
        'evidence','slot version 1; weekday/time match; staff links predate exception; effective revisions corroborate'),
      null,repair_id,x.workspace_id);
end $$;
commit;
