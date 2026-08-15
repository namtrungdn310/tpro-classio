-- Assertions sau khi chạy 051 trên fixture
do $$
declare
  c1_slots jsonb;
  c4_slots jsonb;
begin
  -- C1: slot thiếu teacher_ids phải được backfill từ pool [A]
  select c.schedule -> 'slots' into c1_slots from public.classes c where c.id = '20000000-0000-0000-0000-000000000001';
  if c1_slots -> 0 -> 'teacher_ids' is null
     or jsonb_array_length(c1_slots -> 0 -> 'teacher_ids') <> 1
     or c1_slots -> 0 -> 'teacher_ids' -> 0 <> to_jsonb('10000000-0000-0000-0000-000000000001'::uuid)
  then
    raise exception 'C1 teacher_ids not backfilled from pool';
  end if;

  -- C2: teacher_ids=[] phải được backfill
  if jsonb_array_length(
       (select c.schedule -> 'slots' -> 0 -> 'teacher_ids' from public.classes c where c.id = '20000000-0000-0000-0000-000000000002')
     ) <> 1
  then
    raise exception 'C2 empty teacher_ids not backfilled';
  end if;

  -- C3: explicit [A] không đổi dù pool là [A,B]
  select c.schedule -> 'slots' into c1_slots from public.classes c where c.id = '20000000-0000-0000-0000-000000000003';
  if c1_slots -> 0 -> 'teacher_ids' <> '["10000000-0000-0000-0000-000000000001"]'::jsonb
  then
    raise exception 'C3 explicit teacher_ids must stay unchanged';
  end if;

  -- C4 mixed: slot1 backfill [A] (pool teachers [A,B] — thứ tự theo ID), slot2 explicit giữ nguyên
  -- (teacher [B], assistant [a1]), slot3 rỗng backfill [A,B], số slot = 3, thứ tự giữ nguyên.
  select c.schedule -> 'slots' into c4_slots from public.classes c where c.id = '20000000-0000-0000-0000-000000000004';
  if jsonb_array_length(c4_slots) <> 3 then
    raise exception 'C4 slot count changed';
  end if;
  if c4_slots -> 0 -> 'start' <> '"07:00"'::jsonb
     or c4_slots -> 1 -> 'start' <> '"10:00"'::jsonb
     or c4_slots -> 2 -> 'start' <> '"18:00"'::jsonb
  then
    raise exception 'C4 slot order changed';
  end if;
  if c4_slots -> 0 -> 'teacher_ids' is null
     or jsonb_array_length(c4_slots -> 0 -> 'teacher_ids') <> 2
  then
    raise exception 'C4 slot1 teacher_ids not backfilled from pool';
  end if;
  if c4_slots -> 1 -> 'teacher_ids' <> '["10000000-0000-0000-0000-000000000002"]'::jsonb
     or c4_slots -> 1 -> 'assistant_ids' <> '["10000000-0000-0000-0000-000000000003"]'::jsonb
  then
    raise exception 'C4 slot2 explicit assignment changed';
  end if;
  if c4_slots -> 2 -> 'teacher_ids' is null
     or jsonb_array_length(c4_slots -> 2 -> 'teacher_ids') <> 2
  then
    raise exception 'C4 slot3 empty teacher_ids not backfilled';
  end if;

  -- C5: explicit teacher + assistant không đổi; assistant không bị backfill/chạm
  if (select c.schedule -> 'slots' -> 0 -> 'assistant_ids' from public.classes c where c.id = '20000000-0000-0000-0000-000000000005')
     <> '["10000000-0000-0000-0000-000000000003"]'::jsonb
  then
    raise exception 'C5 assistant assignment changed';
  end if;

  -- Không còn slot thiếu/rỗng teacher_ids trên toàn bảng
  if exists (
    select 1 from public.classes c,
      jsonb_array_elements(c.schedule -> 'slots') slot
    where c.schedule is not null
      and (not (slot ? 'teacher_ids')
           or jsonb_array_length(coalesce(slot -> 'teacher_ids', '[]'::jsonb)) = 0)
  ) then
    raise exception 'remaining missing teacher_ids after 051';
  end if;

  raise notice 'M051 fixture assertions OK';
end $$;
