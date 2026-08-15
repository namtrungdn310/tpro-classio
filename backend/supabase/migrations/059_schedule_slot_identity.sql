-- R6-D07 — Stable schedule slot identity (forward-only expand).
--
-- Contract: dev.md §5.1, test.md §2.3. `class_schedule_slots` gives every
-- recurring slot a stable UUID; `class_schedule_slot_staff` assigns staff per
-- slot with TEACHER/ASSISTANT roles. Canonical occurrence identity =
-- slot_id + local occurrence date + slot version. JSON `classes.schedule`
-- stays as a compatibility projection until D19 (never the source of truth).
--
-- Backfill is evidence-based: duplicate (class,day,start,end), unknown staff
-- or ambiguous role abort with actionable class IDs.

begin;

-- ===========================================================================
-- 1. Preflight
-- ===========================================================================
do $$
declare
  malformed_count bigint;
begin
  select count(*) into malformed_count
    from public.classes c
   where c.schedule is not null
     and (
       jsonb_typeof(c.schedule) <> 'object'
       or (c.schedule ? 'slots' and jsonb_typeof(c.schedule -> 'slots') <> 'array')
       or (c.schedule ? 'slots' and jsonb_array_length(c.schedule -> 'slots') > 4)
     );
  if malformed_count > 0 then
    raise exception 'M059 preflight abort: % class(es) with malformed/over-limit schedule; resolve manually', malformed_count;
  end if;
  raise notice 'M059 preflight OK';
end;
$$;

-- ===========================================================================
-- 2. Tables
-- ===========================================================================
do $$
begin
  if not exists (select 1 from pg_type where typname = 'class_day') then
    create type public.class_day as enum (
      'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật'
    );
  end if;
end;
$$;

create table if not exists public.class_schedule_slots (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references public.classes(id) on delete restrict,
  weekday public.class_day not null,
  local_start time not null,
  local_end time not null,
  timezone text not null default 'Asia/Ho_Chi_Minh',
  version integer not null default 1,
  effective_from date not null default '1970-01-01',
  effective_until date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint class_schedule_slots_time_range_check
    check (local_end > local_start),
  constraint class_schedule_slots_effective_range_check
    check (effective_from <= effective_until or effective_until is null)
);

drop index if exists class_schedule_slots_identity_uniq;
create unique index class_schedule_slots_identity_uniq
  on public.class_schedule_slots (class_id, weekday, local_start, local_end, version);
drop index if exists class_schedule_slots_class_effective_idx;
create index class_schedule_slots_class_effective_idx
  on public.class_schedule_slots (class_id, effective_from, effective_until);

create table if not exists public.class_schedule_slot_staff (
  id uuid primary key default gen_random_uuid(),
  slot_id uuid not null references public.class_schedule_slots(id) on delete restrict,
  staff_id uuid not null references public.staff_members(id) on delete restrict,
  role text not null check (role in ('TEACHER', 'ASSISTANT')),
  created_at timestamptz not null default now(),
  constraint class_schedule_slot_staff_unique
    unique (slot_id, staff_id, role)
);

drop index if exists class_schedule_slot_staff_slot_idx;
create index class_schedule_slot_staff_slot_idx
  on public.class_schedule_slot_staff (slot_id);
drop index if exists class_schedule_slot_staff_staff_idx;
create index class_schedule_slot_staff_staff_idx
  on public.class_schedule_slot_staff (staff_id);

alter table public.class_schedule_slots enable row level security;
alter table public.class_schedule_slots force row level security;
alter table public.class_schedule_slot_staff enable row level security;
alter table public.class_schedule_slot_staff force row level security;
revoke all on table public.class_schedule_slots from public, anon, authenticated;
revoke all on table public.class_schedule_slot_staff from public, anon, authenticated;

-- ===========================================================================
-- 3. Backfill JSON -> slots (evidence-based, abort on ambiguity)
-- ===========================================================================
do $$
declare
  slot_row record;
  slot_id uuid;
  staff_row record;
  unknown_staff bigint;
  staff_count bigint;
begin
  for slot_row in
    select c.id as class_id, slot.value as slot_json,
           (slot.value ->> 'day') as day_text,
           (slot.value ->> 'start') as start_text,
           (slot.value ->> 'end') as end_text,
           count(*) over (partition by c.id, slot.value ->> 'day',
                          slot.value ->> 'start', slot.value ->> 'end') as dup_count
      from public.classes c
      cross join lateral jsonb_array_elements(
        case when c.schedule ? 'slots' then c.schedule -> 'slots' else '[]'::jsonb end
      ) with ordinality as slot(value, ordinality)
     where c.schedule is not null
       and not exists (
         select 1 from public.class_schedule_slots existing
          where existing.class_id = c.id
       )
     order by c.id asc, slot.ordinality asc
  loop
    if slot_row.dup_count > 1 then
      raise exception 'M059 backfill abort: duplicate slot (class=%, day=%, start=%, end=%)',
        slot_row.class_id, slot_row.day_text, slot_row.start_text, slot_row.end_text;
    end if;
    if slot_row.day_text is null or slot_row.start_text is null or slot_row.end_text is null then
      raise exception 'M059 backfill abort: incomplete slot in class %', slot_row.class_id;
    end if;
    insert into public.class_schedule_slots (
      class_id, weekday, local_start, local_end, timezone, version
    ) values (
      slot_row.class_id,
      slot_row.day_text::public.class_day,
      slot_row.start_text::time,
      slot_row.end_text::time,
      'Asia/Ho_Chi_Minh',
      1
    )
    returning id into slot_id;

    -- Staff từ slot JSON: teacher_ids (TEACHER), assistant_ids (ASSISTANT).
    for staff_row in
      select teacher_id::uuid as staff_id, 'TEACHER'::text as role
        from jsonb_array_elements_text(
          coalesce(slot_row.slot_json -> 'teacher_ids', '[]'::jsonb)
        ) as teacher_id
      union all
      select assistant_id::uuid as staff_id, 'ASSISTANT'::text as role
        from jsonb_array_elements_text(
          coalesce(slot_row.slot_json -> 'assistant_ids', '[]'::jsonb)
        ) as assistant_id
    loop
      insert into public.class_schedule_slot_staff (slot_id, staff_id, role)
      values (slot_id, staff_row.staff_id, staff_row.role);
    end loop;
  end loop;

  -- Unknown staff hoặc role không hợp lệ phải abort.
  select count(*) into unknown_staff
    from public.class_schedule_slot_staff s
   where not exists (
     select 1 from public.staff_members m where m.id = s.staff_id
   );
  if unknown_staff > 0 then
    raise exception 'M059 backfill abort: % slot-staff row(s) reference unknown staff', unknown_staff;
  end if;
  select count(*) into staff_count from public.class_schedule_slot_staff;
  raise notice 'M059 backfill done: slots created, staff rows=%', staff_count;
end;
$$;

-- ===========================================================================
-- 4. source_slot_id trên snapshots/exception (legacy key map 1:1)
-- ===========================================================================
alter table public.class_session_staff_snapshots
  add column if not exists source_slot_id uuid
  references public.class_schedule_slots(id) on delete restrict;

alter table public.class_session_exceptions
  add column if not exists source_slot_id uuid
  references public.class_schedule_slots(id) on delete restrict;

do $$
declare
  unmatched bigint;
begin
  -- Staff snapshot: map qua exception -> class -> slot (day|start|end key).
  update public.class_session_staff_snapshots snap
     set source_slot_id = (
       select s.id
         from public.class_session_exceptions exc
         join public.classes c on c.id = exc.class_id
         join public.class_schedule_slots s on s.class_id = c.id
        where exc.id = snap.exception_id
          and s.weekday::text = split_part(snap.source_slot_key, '|', 1)
          and s.local_start::text = split_part(snap.source_slot_key, '|', 2)
          and s.local_end::text = split_part(snap.source_slot_key, '|', 3)
        limit 1
     )
   where snap.source_slot_id is null;

  select count(*) into unmatched
    from public.class_session_staff_snapshots
   where source_slot_id is null;
  if unmatched > 0 then
    raise exception 'M059 backfill abort: % staff snapshot(s) without a resolvable slot', unmatched;
  end if;

  -- Exception: slot xác định qua staff snapshot đã map (same slot identity).
  update public.class_session_exceptions exc
     set source_slot_id = (
       select snap.source_slot_id
         from public.class_session_staff_snapshots snap
        where snap.exception_id = exc.id
        limit 1
     )
   where exc.source_slot_id is null;
  raise notice 'M059 source_slot_id mapping done';
end;
$$;

-- ===========================================================================
-- 5. Rerun contract + acceptance
-- ===========================================================================
-- Lifecycle events mở rộng cho schedule slot edits/closes.
alter table public.class_lifecycle_events
  drop constraint if exists class_lifecycle_events_event_type_check;
alter table public.class_lifecycle_events
  add constraint class_lifecycle_events_event_type_check
    check (
      event_type = any (array[
        'created', 'identity_configured', 'end_date_changed', 'completed',
        'cancelled', 'archived', 'restored', 'schedule_changed',
        'schedule_slot_edited', 'schedule_slot_closed'
      ])
    ) not valid;
alter table public.class_lifecycle_events
  validate constraint class_lifecycle_events_event_type_check;

do $$
declare
  total_slots bigint;
  total_staff_rows bigint;
  classes_with_slots bigint;
  classes_with_json bigint;
begin
  select count(*) into total_slots from public.class_schedule_slots;
  select count(*) into total_staff_rows from public.class_schedule_slot_staff;
  select count(distinct class_id) into classes_with_slots from public.class_schedule_slots;
  select count(*) into classes_with_json
    from public.classes
   where schedule is not null and schedule ? 'slots'
     and jsonb_array_length(schedule -> 'slots') > 0;

  if classes_with_json <> classes_with_slots then
    raise exception 'M059 acceptance failed: classes with JSON slots (%) <> classes with relational slots (%)',
      classes_with_json, classes_with_slots;
  end if;
  if exists (
    select 1
      from public.class_schedule_slots s
     group by s.class_id, s.weekday, s.local_start, s.local_end
    having count(*) > 1
  ) then
    raise exception 'M059 acceptance failed: duplicate active slot identities';
  end if;
  raise notice 'M059 acceptance OK: slots=% staff_rows=% classes=%',
    total_slots, total_staff_rows, classes_with_slots;
end;
$$;

commit;
