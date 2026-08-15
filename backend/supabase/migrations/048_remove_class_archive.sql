-- The class archive/restore concept was removed from the product model.
-- Keep class history, enrollment membership periods and fee ledgers intact.
-- This migration is safe when 047 was not applied: every object is optional.

begin;

drop index if exists public.classes_archive_browse_idx;

alter table public.classes
  drop constraint if exists classes_archive_state_check,
  drop constraint if exists classes_archive_metadata_check,
  drop constraint if exists classes_archive_reason_check,
  drop constraint if exists classes_archive_actor_snapshot_check,
  drop column if exists archived_at,
  drop column if exists archived_by,
  drop column if exists archive_reason,
  drop column if exists archived_by_name_snapshot;

-- Existing archive/restore lifecycle events remain immutable audit evidence.
-- The event check is intentionally left compatible with those historical rows;
-- application code no longer creates or exposes archive transitions.

commit;
