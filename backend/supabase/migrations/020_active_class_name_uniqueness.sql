-- Active class names are business identifiers in the management UI.
-- Archived classes may keep their historical names and a future class may reuse one.
create unique index if not exists classes_active_name_unique_idx
  on public.classes (lower(btrim(name)))
  where is_active = true;
