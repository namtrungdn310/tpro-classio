-- EXPLAIN (ANALYZE) của query classes list chuẩn cho Slide lịch — bằng chứng index
-- 052 (idx_classes_active_created_at_desc) được sử dụng, execution < 1ms trên
-- dataset 971 lớp / 459 nhân sự.
\echo '--- 1. Classes list (đúng index 052) ---'
EXPLAIN (ANALYZE, BUFFERS)
select c.id, c.name, c.teacher_id, c.schedule
from public.classes c
where c.is_active
  and c.cancelled_at is null
  and c.completed_at is null
order by c.created_at desc
limit 50;

\echo '--- 2. Overlap classes theo class_teachers (đúng index 051) ---'
EXPLAIN (ANALYZE, BUFFERS)
select c.id, c.name
from public.classes c
join public.class_teachers ct on ct.class_id = c.id
where c.is_active
  and c.cancelled_at is null
  and c.completed_at is null
  and ct.teacher_id in (
    '0da281ea-4a29-4671-8512-fa0b78de9c2d',
    '0297a7a8-24a4-4e1c-83fc-c92cb90f7ea0'
  )
  and (c.end_date is null or c.end_date >= '2026-09-01'::date)
  and (c.start_date is null or c.start_date <= '2026-10-26'::date)
limit 50;

\echo '--- 3. Class list + unresolved make-up count (053) ---'
EXPLAIN (ANALYZE, BUFFERS)
select c.id, c.name, coalesce(u.unresolved_count, 0) as unresolved_count
from public.classes c
left join (
  select class_id, count(*) as unresolved_count
  from public.class_session_exceptions
  where status in ('MAKEUP_PENDING', 'MAKEUP_SCHEDULED')
  group by class_id
) u on u.class_id = c.id
where c.is_active
  and c.cancelled_at is null
  and c.completed_at is null
  and c.identity_scheme <> 'LEGACY'
  and c.start_date <= '2026-10-26'::date
  and (c.end_date >= '2026-10-26'::date or exists (
    select 1 from public.class_session_exceptions e
    where e.class_id = c.id
      and e.status in ('MAKEUP_PENDING', 'MAKEUP_SCHEDULED')
  ))
order by c.created_at desc
limit 50;

\echo '--- 4. Replacement conflict lookup (053 index) ---'
EXPLAIN (ANALYZE, BUFFERS)
select e.id, e.class_id
from public.class_session_exceptions e
where e.replacement_start_at is not null
  and e.replacement_start_at < '2026-09-10T12:00:00+00:00'::timestamptz
  and '2026-09-10T11:00:00+00:00'::timestamptz < e.replacement_end_at
  and e.status in ('MAKEUP_SCHEDULED', 'MAKEUP_COMPLETED')
limit 20;

\echo '--- 5. Unresolved obligations per class (053 index) ---'
EXPLAIN (ANALYZE, BUFFERS)
select class_id, count(*)
from public.class_session_exceptions
where status in ('MAKEUP_PENDING', 'MAKEUP_SCHEDULED')
group by class_id;
