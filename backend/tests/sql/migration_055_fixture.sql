-- R6-D04 055 fixture: legacy students WITHOUT codes (backfill targets) plus a
-- duplicate-name pair to exercise deterministic ordering.
\set ON_ERROR_STOP on

insert into public.students (id, full_name, status, created_at)
values
  ('20000000-0000-0000-0000-000000000101', 'M055 Legacy A', 'active', '2026-01-01T00:00:00+00:00'),
  ('20000000-0000-0000-0000-000000000102', 'M055 Legacy B', 'active', '2026-01-02T00:00:00+00:00'),
  ('20000000-0000-0000-0000-000000000103', 'M055 Legacy C', 'inactive', '2026-01-03T00:00:00+00:00');
