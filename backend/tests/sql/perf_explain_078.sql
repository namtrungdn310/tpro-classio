-- EXPLAIN (ANALYZE, BUFFERS) for the Round 8 projection indexes (078).
--
-- Runs on the scale dataset (perf_scale_dataset.sql) BEFORE and AFTER 078.
-- Each query is shaped so the partial index applies (non-LEGACY + date range /
-- UNPAID).  JSON format so a runner can persist the plan; warm runs capture
-- p50/p95/p99 in the Python measurer.

\echo '--- 078 #1: class operational scope (partial index applies) ---'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING, FORMAT JSON)
select c.id, c.name, c.start_date, c.end_date, c.identity_scheme
from public.classes c
where c.is_active = true
  and c.cancelled_at is null
  and c.completed_at is null
  and c.identity_scheme <> 'LEGACY'
  and c.start_date <= date '2026-09-15'
  and c.end_date >= date '2026-09-15'
order by c.created_at desc, c.id desc
limit 50;

\echo '--- 078 #2: class active scope ---'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING, FORMAT JSON)
select c.id, c.name
from public.classes c
where c.is_active = true
  and c.cancelled_at is null
  and c.completed_at is null
  and c.identity_scheme <> 'LEGACY'
  and c.start_date <= date '2026-09-15'
  and c.end_date >= date '2026-09-15'
order by c.created_at desc, c.id desc
limit 50;

\echo '--- 078 #3: class scheduled scope ---'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING, FORMAT JSON)
select c.id, c.name
from public.classes c
where c.is_active = true
  and c.cancelled_at is null
  and c.completed_at is null
  and c.identity_scheme <> 'LEGACY'
  and c.start_date > date '2026-09-15'
  and c.end_date > date '2026-09-15'
order by c.created_at desc, c.id desc
limit 50;

\echo '--- 078 #4: class completed scope ---'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING, FORMAT JSON)
select c.id, c.name
from public.classes c
where c.cancelled_at is null
  and c.identity_scheme <> 'LEGACY'
  and (c.completed_at is not null
       or (c.is_active = true and c.end_date < date '2026-09-15'))
order by c.created_at desc, c.id desc
limit 50;

\echo '--- 078 #5: class search + cursor page (10 rows, offset 200) ---'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING, FORMAT JSON)
select c.id, c.name
from public.classes c
where c.identity_scheme <> 'LEGACY'
  and c.cancelled_at is null
  and c.completed_at is null
  and c.name ilike 'PerfLop 3%'
order by c.created_at desc, c.id desc
limit 10 offset 200;

\echo '--- 078 #6: fee UNPAID projection — 10 enrollments ---'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING, FORMAT JSON)
select fr.enrollment_id, fr.adjusted_due_date, fr.due_date
from public.fee_records fr
where fr.enrollment_id = any(
  array(
    select e.id from public.enrollments e
    join public.classes c on c.id = e.class_id
    where c.identity_scheme <> 'LEGACY' and c.completed_at is null
    limit 10
  )
)
  and fr.status = 'UNPAID'
order by fr.enrollment_id, fr.adjusted_due_date, fr.due_date;

\echo '--- 078 #7: fee UNPAID projection — 100 enrollments ---'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING, FORMAT JSON)
select fr.enrollment_id, fr.adjusted_due_date, fr.due_date
from public.fee_records fr
where fr.enrollment_id = any(
  array(
    select e.id from public.enrollments e
    join public.classes c on c.id = e.class_id
    where c.identity_scheme <> 'LEGACY' and c.completed_at is null
    limit 100
  )
)
  and fr.status = 'UNPAID'
order by fr.enrollment_id, fr.adjusted_due_date, fr.due_date;

\echo '--- 078 #8: fee UNPAID projection — 500 enrollments ---'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING, FORMAT JSON)
select fr.enrollment_id, fr.adjusted_due_date, fr.due_date
from public.fee_records fr
where fr.enrollment_id = any(
  array(
    select e.id from public.enrollments e
    join public.classes c on c.id = e.class_id
    where c.identity_scheme <> 'LEGACY' and c.completed_at is null
    limit 500
  )
)
  and fr.status = 'UNPAID'
order by fr.enrollment_id, fr.adjusted_due_date, fr.due_date;

\echo '--- 078 #9: fee UNPAID projection — 1000 enrollments ---'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING, FORMAT JSON)
select fr.enrollment_id, fr.adjusted_due_date, fr.due_date
from public.fee_records fr
where fr.enrollment_id = any(
  array(
    select e.id from public.enrollments e
    join public.classes c on c.id = e.class_id
    where c.identity_scheme <> 'LEGACY' and c.completed_at is null
    limit 1000
  )
)
  and fr.status = 'UNPAID'
order by fr.enrollment_id, fr.adjusted_due_date, fr.due_date;

\echo '--- 078 #10: class scope with unresolved make-up count (053 + 078) ---'
EXPLAIN (ANALYZE, BUFFERS, SETTINGS, TIMING, FORMAT JSON)
select c.id, c.name, coalesce(u.unresolved_count, 0) as unresolved_count
from public.classes c
left join (
  select class_id, count(*) as unresolved_count
  from public.class_session_exceptions
  where status in ('MAKEUP_PENDING', 'MAKEUP_SCHEDULED')
  group by class_id
) u on u.class_id = c.id
where c.is_active = true
  and c.cancelled_at is null
  and c.completed_at is null
  and c.identity_scheme <> 'LEGACY'
  and c.start_date <= date '2026-09-15'
  and c.end_date >= date '2026-09-15'
order by c.created_at desc, c.id desc
limit 50;
