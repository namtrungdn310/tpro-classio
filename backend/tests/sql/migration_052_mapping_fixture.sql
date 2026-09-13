-- Mapping: event ambiguous (Cô Mai unassigned C6) -> TEACHER (xác minh thủ công)
insert into public._m052_role_snapshot_mapping (event_id, role)
select id, 'TEACHER'
  from public.class_teacher_events
 where teacher_id = '10000000-0000-0000-0000-000000000004'
   and event_type = 'unassigned'
on conflict (event_id) do update set role = excluded.role;
