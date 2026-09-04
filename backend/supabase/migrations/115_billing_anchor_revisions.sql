-- Versioned enrollment billing anchors, review queue and final-cycle markers.
begin;

set local lock_timeout = '5s';
set local statement_timeout = '5min';

create table if not exists public.billing_anchor_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  enrollment_id uuid not null references public.enrollments(id) on delete restrict,
  sequence_no integer not null check (sequence_no >= 0),
  previous_anchor_date date,
  anchor_date date not null,
  effective_on date not null,
  generation_floor date not null,
  first_anchor_cycle_no integer not null check (first_anchor_cycle_no >= 0),
  next_due_date date not null,
  state text not null check (state in ('PENDING', 'CONFIRMED', 'SUPERSEDED')),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  request_id uuid not null,
  actor_user_id uuid references public.profiles(id) on delete set null,
  resolved_by uuid references public.profiles(id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  constraint billing_anchor_revisions_sequence_unique
    unique (workspace_id, enrollment_id, sequence_no),
  constraint billing_anchor_revisions_request_unique
    unique (workspace_id, request_id),
  constraint billing_anchor_revisions_resolution_shape check (
    (state = 'PENDING' and resolved_at is null)
    or (state <> 'PENDING' and resolved_at is not null)
  )
);

alter table public.enrollments
  add column if not exists current_billing_revision_id uuid,
  add column if not exists billing_anchor_version integer not null default 0;

alter table public.fee_records
  add column if not exists billing_revision_id uuid,
  add column if not exists anchor_cycle_no integer,
  add column if not exists review_required boolean not null default false,
  add column if not exists is_final_cycle boolean not null default false,
  add column if not exists final_cycle_reason text;

insert into public.billing_anchor_revisions (
  workspace_id, enrollment_id, sequence_no, previous_anchor_date, anchor_date,
  effective_on, generation_floor, first_anchor_cycle_no, next_due_date, state,
  reason, request_id, resolved_at, resolution_note
)
select e.workspace_id, e.id, 0, null, e.enrollment_date,
       coalesce(e.created_at::date, e.enrollment_date), e.enrollment_date, 0,
       e.enrollment_date, 'CONFIRMED', 'Lịch thu hiện có trước khi nâng cấp',
       gen_random_uuid(), now(), 'Tự động xác nhận khi chuyển đổi dữ liệu'
from public.enrollments e
where e.enrollment_date is not null
  and not exists (
    select 1 from public.billing_anchor_revisions r where r.enrollment_id = e.id
  );

update public.enrollments e
set current_billing_revision_id = r.id
from public.billing_anchor_revisions r
where r.enrollment_id = e.id
  and r.sequence_no = 0
  and e.current_billing_revision_id is null;

update public.fee_records f
set billing_revision_id = e.current_billing_revision_id,
    anchor_cycle_no = f.cycle_no
from public.enrollments e
where e.id = f.enrollment_id
  and f.billing_revision_id is null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.enrollments'::regclass
      and conname = 'enrollments_current_billing_revision_fkey'
  ) then
    alter table public.enrollments
      add constraint enrollments_current_billing_revision_fkey
      foreign key (current_billing_revision_id)
      references public.billing_anchor_revisions(id) on delete restrict;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.fee_records'::regclass
      and conname = 'fee_records_billing_revision_fkey'
  ) then
    alter table public.fee_records
      add constraint fee_records_billing_revision_fkey
      foreign key (billing_revision_id)
      references public.billing_anchor_revisions(id) on delete restrict;
  end if;
end $$;

create unique index if not exists ux_fee_records_revision_anchor_cycle
  on public.fee_records (billing_revision_id, anchor_cycle_no)
  where billing_revision_id is not null and status <> 'SUPERSEDED';

create index if not exists billing_anchor_revisions_pending_idx
  on public.billing_anchor_revisions (workspace_id, created_at desc)
  where state = 'PENDING';

create index if not exists fee_records_review_required_idx
  on public.fee_records (workspace_id, created_at desc)
  where review_required and status = 'UNPAID';

alter table public.billing_anchor_revisions enable row level security;
alter table public.billing_anchor_revisions force row level security;
revoke all on table public.billing_anchor_revisions from public, anon, authenticated;

do $$
declare runtime_role name;
begin
  for runtime_role in
    select rolname from pg_roles
    where rolname in ('tpro_backend', 'tpro_runtime')
  loop
    execute format(
      'grant select, insert, update on table public.billing_anchor_revisions to %I',
      runtime_role
    );
  end loop;
  if exists (select 1 from pg_roles where rolname = 'tpro_runtime') then
    drop policy if exists billing_anchor_revisions_workspace_boundary
      on public.billing_anchor_revisions;
    create policy billing_anchor_revisions_workspace_boundary
      on public.billing_anchor_revisions for all to tpro_runtime
      using (workspace_id = public.current_workspace_id())
      with check (workspace_id = public.current_workspace_id());
  end if;
end $$;

drop trigger if exists billing_anchor_revisions_workspace_stamp
  on public.billing_anchor_revisions;
create trigger billing_anchor_revisions_workspace_stamp
before insert or update on public.billing_anchor_revisions
for each row execute function public.stamp_workspace_id();

-- A COURSE enrollment owns its personal package anchor. It no longer has to
-- align with the class opening date; it still cannot predate the class.
create or replace function public.enforce_enrollment_class_date_range()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  class_start date;
  class_scheme text;
  class_is_active boolean;
  class_cancelled_at timestamptz;
  class_completed_at timestamptz;
  class_stopped_at timestamptz;
begin
  if new.status::text <> 'active' then return new; end if;
  select c.start_date, c.identity_scheme::text, c.is_active, c.cancelled_at,
         c.completed_at, c.stopped_at
    into class_start, class_scheme, class_is_active, class_cancelled_at,
         class_completed_at, class_stopped_at
  from public.classes c where c.id = new.class_id;
  if not found then raise exception 'enrollment class does not exist'; end if;
  if not class_is_active or class_cancelled_at is not null
     or class_completed_at is not null or class_stopped_at is not null then
    raise exception 'active enrollment requires an operational class';
  end if;
  if class_scheme <> 'LEGACY' then
    if new.enrollment_date is null then
      raise exception 'active enrollment_date is required';
    end if;
    if new.enrollment_date < class_start then
      raise exception 'enrollment_date must be on or after class start_date';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.billing_anchor_revision_version()
returns integer language sql immutable set search_path = pg_catalog
as $$ select 1 $$;
revoke all on function public.billing_anchor_revision_version()
  from public, anon, authenticated;

commit;
