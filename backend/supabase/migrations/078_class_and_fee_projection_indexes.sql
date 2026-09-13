-- R8-D11 — Projection indexes for class list and fee due-date reads (forward-only).
--
-- These indexes serve the hottest list/projection queries after the Round 8
-- performance pass.  Each index is documented with the query it serves, the
-- expected benefit, the write cost and the exact rollback statement.  The
-- EXPLAIN ANALYZE before/after numbers belong in the performance report on the
-- disposable benchmark DB before these are promoted on Supabase.
--
-- CONCURRENT build: CREATE INDEX CONCURRENTLY must run OUTSIDE a transaction
-- (PostgreSQL forbids it inside BEGIN/COMMIT) and never holds a lock that
-- blocks writes.  This is required for a busy Supabase database where the
-- classes/fee_records tables are too large to take a maintenance lock.  Each
-- concurrent index is created in its own top-level statement; the acceptance
-- DO block runs afterwards and only checks metadata (never data).
--
-- Idempotency + failure handling: `create index concurrently if not exists`
-- is safe to re-run; a failed concurrent build leaves an invalid index which
-- the promote runbook must detect via pg_index.indisvalid and drop.
--
-- Index 1 — fee_records unpaid projection
--   Query served (next-fee-due map used by /classes and /fees):
--     select enrollment_id, adjusted_due_date, due_date
--       from fee_records
--      where enrollment_id in (...) and status = 'UNPAID';
--   Before: heap scan filtered on status for every enrollment batch.
--   After:  partial index gives each UNPAID row directly from the index.
--   Benefit: turns a scan over all fee records of a class into an index-only
--            UNPAID read; matters most for long-running classes (many cycles).
--   Write cost: the partial index tracks only UNPAID rows; rows that leave the
--               UNPAID state (PAID/VOID/SUPERSEDED) are dropped from it, so
--               insert/status-update overhead is limited to the open set.
--   Rollback: drop index if exists ix_fee_records_unpaid_enrollment;
--
-- Index 2 — classes operational scope browse
--   Query served (class_service.get_classes scope predicates):
--     ... where is_active = true
--       and cancelled_at is null
--       and completed_at is null
--       and identity_scheme <> 'LEGACY'
--       and start_date <= today
--       and end_date >= today
--       and end_date >= today ... (active/enrollable/scheduled variants)
--   Before: partial operational indexes (044/053) do not cover the completed_at
--           /identity_scheme/date-range filters, forcing a residual filter.
--   After:  one partial index matches the scope filter set for every non-LEGACY
--           class and bounds the scan to the visible set.
--   Benefit: class lists stop scanning all rows; the dominant /classes cost
--            becomes the (already batched) fee-due projection, not the scan.
--   Write cost: one row per class; updated only on lifecycle transitions
--               (cancel/complete/reactivate) which are rare.
--   Rollback: drop index if exists classes_scope_browse_idx;

create index concurrently if not exists ix_fee_records_unpaid_enrollment
  on public.fee_records (enrollment_id, adjusted_due_date, due_date)
  where status = 'UNPAID';

create index concurrently if not exists classes_scope_browse_idx
  on public.classes (is_active, cancelled_at, completed_at, start_date, end_date, id)
  where identity_scheme <> 'LEGACY';

do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'fee_records'
       and indexname = 'ix_fee_records_unpaid_enrollment'
  ) then
    raise exception '078 acceptance failed: ix_fee_records_unpaid_enrollment is missing';
  end if;
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and tablename = 'classes'
       and indexname = 'classes_scope_browse_idx'
  ) then
    raise exception '078 acceptance failed: classes_scope_browse_idx is missing';
  end if;
  -- Verify both are valid and ready (a failed concurrent build is indisvalid).
  if exists (
    select 1
      from pg_index idx
      join pg_class rel on rel.oid = idx.indexrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname in (
         'ix_fee_records_unpaid_enrollment',
         'classes_scope_browse_idx'
       )
       and (not idx.indisvalid or not idx.indisready)
  ) then
    raise exception
      '078 acceptance failed: a projection index is invalid or not ready '
      '(clean up the invalid concurrent index before retrying)';
  end if;
  raise notice '078 acceptance OK: projection indexes valid, ready and installed';
end;
$$;
