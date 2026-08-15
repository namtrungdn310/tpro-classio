-- Dataset performance: 100 staff + 600 classes (500 historical, 100 active), 4 slot/class
do $$
declare
  i int;
  staff_id uuid;
  class_id uuid;
  teacher_count int := 0;
  class_count int := 0;
begin
  -- 100 staff (50 teacher, 50 assistant)
  for i in 1..100 loop
    staff_id := gen_random_uuid();
    insert into public.staff_members (id, full_name, staff_type, zalo_name, phone, is_active)
    values (staff_id, 'Perf Staff ' || i,
            case when i <= 50 then 'TEACHER' else 'ASSISTANT' end,
            'perf-' || i,
            '09' || lpad((i % 90000000)::text, 8, '0'),
            true);
  end loop;

  -- 600 classes: 500 historical (completed), 100 active; mỗi class 4 slot
  for i in 1..600 loop
    class_id := gen_random_uuid();
    declare
      is_historical boolean := i > 500;
      t1 uuid; t2 uuid; a1 uuid;
    begin
      select id into t1 from public.staff_members
       where staff_type = 'TEACHER' order by id limit 1 offset ((i * 7) % 50);
      select id into t2 from public.staff_members
       where staff_type = 'TEACHER' order by id limit 1 offset ((i * 13 + 3) % 50);
      select id into a1 from public.staff_members
       where staff_type = 'ASSISTANT' order by id limit 1 offset ((i * 5) % 50);

      insert into public.classes (id, name, type, base_fee, billing_cycle_months,
                                  teacher_id, identity_scheme, is_active, schedule,
                                  start_date, end_date, completed_at)
      values (class_id, 'Perf Class ' || i, 'MONTHLY', 750000, 1, t1, 'LEGACY',
              true,
              jsonb_build_object(
                'text', 'Thứ 2 (18:00-19:30)',
                'slots', jsonb_build_array(
                  jsonb_build_object('day', 'Thứ 2', 'start', '18:00', 'end', '19:30',
                                     'teacher_ids', jsonb_build_array(t1), 'assistant_ids', '[]'::jsonb),
                  jsonb_build_object('day', 'Thứ 4', 'start', '18:00', 'end', '19:30',
                                     'teacher_ids', jsonb_build_array(t2), 'assistant_ids', jsonb_build_array(a1)),
                  jsonb_build_object('day', 'Thứ 6', 'start', '19:00', 'end', '20:30',
                                     'teacher_ids', jsonb_build_array(t1, t2), 'assistant_ids', '[]'::jsonb),
                  jsonb_build_object('day', 'Chủ Nhật', 'start', '09:00', 'end', '10:00',
                                     'teacher_ids', jsonb_build_array(t2), 'assistant_ids', '[]'::jsonb)
                )
              ),
              case when is_historical then '2024-09-01'::date else '2026-09-01'::date end,
              case when is_historical then '2025-05-31'::date else '2027-05-31'::date end,
              case when is_historical then now() else null end);

      insert into public.class_teachers (class_id, teacher_id) values (class_id, t1);
      insert into public.class_teachers (class_id, teacher_id) values (class_id, t2);
      insert into public.class_teachers (class_id, teacher_id) values (class_id, a1);
    end;
  end loop;
end $$;
