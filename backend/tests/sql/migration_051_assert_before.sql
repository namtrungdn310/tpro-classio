-- Assertions TRƯỚC khi chạy 051 trên fixture (dùng cho scenario rollback):
-- trạng thái legacy gốc của C1..C5 — slot thiếu/rỗng teacher_ids còn nguyên.
do $$
declare
  c1_missing boolean;
  c2_empty boolean;
begin
  select (c.schedule -> 'slots' -> 0 -> 'teacher_ids') is null
    into c1_missing
    from public.classes c
   where c.id = '20000000-0000-0000-0000-000000000001';
  if not c1_missing then
    raise exception 'C1 teacher_ids must be missing in before-state';
  end if;

  select jsonb_array_length(c.schedule -> 'slots' -> 0 -> 'teacher_ids') = 0
    into c2_empty
    from public.classes c
   where c.id = '20000000-0000-0000-0000-000000000002';
  if not c2_empty then
    raise exception 'C2 teacher_ids must be empty in before-state';
  end if;

  raise notice 'M051 before-state assertions OK';
end $$;
