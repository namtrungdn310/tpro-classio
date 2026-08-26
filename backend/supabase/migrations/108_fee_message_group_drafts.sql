-- One editable Zalo draft per workspace, student, fee period and message kind.
-- Explicit line feeds in message are business data and must remain byte-for-byte.
begin;

create table if not exists public.fee_message_drafts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  student_id uuid not null references public.students(id) on delete cascade,
  period text not null check (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  kind text not null,
  message text not null,
  source_fingerprint text not null,
  template_hash text not null,
  revision integer not null default 1,
  created_by uuid references public.profiles(id) on delete set null,
  updated_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint fee_message_drafts_kind_check check (kind in ('reminder', 'received')),
  constraint fee_message_drafts_revision_check check (revision >= 1),
  constraint fee_message_drafts_message_check check (
    char_length(message) between 1 and 2000 and btrim(message) <> ''
  ),
  constraint fee_message_drafts_group_unique
    unique (workspace_id, student_id, period, kind)
);

create index if not exists fee_message_drafts_workspace_period_idx
  on public.fee_message_drafts (workspace_id, period, updated_at desc);

-- Migrate only groups whose legacy per-record copies are complete and equal.
-- Any ambiguous group aborts instead of silently choosing one message.
do $$
begin
  if exists (
    select 1
    from public.fee_records fee
    join public.enrollments enrollment on enrollment.id = fee.enrollment_id
    group by fee.workspace_id, enrollment.student_id, fee.period
    having count(distinct fee.reminder_message_draft)
             filter (where fee.reminder_message_draft is not null) > 1
        or count(distinct fee.received_message_draft)
             filter (where fee.received_message_draft is not null) > 1
  ) then
    raise exception '108 blocked: conflicting legacy Zalo drafts require review';
  end if;
end $$;

insert into public.fee_message_drafts (
  workspace_id, student_id, period, kind, message,
  source_fingerprint, template_hash, revision
)
select
  fee.workspace_id,
  enrollment.student_id,
  fee.period,
  draft.kind,
  max(draft.message),
  encode(digest('legacy:' || string_agg(fee.id::text, ',' order by fee.id), 'sha256'), 'hex'),
  encode(digest('legacy-template', 'sha256'), 'hex'),
  1
from public.fee_records fee
join public.enrollments enrollment on enrollment.id = fee.enrollment_id
cross join lateral (
  values
    ('reminder'::text, fee.reminder_message_draft),
    ('received'::text, fee.received_message_draft)
) as draft(kind, message)
where draft.message is not null and btrim(draft.message) <> ''
group by fee.workspace_id, enrollment.student_id, fee.period, draft.kind
on conflict on constraint fee_message_drafts_group_unique do nothing;

alter table public.fee_message_drafts enable row level security;
alter table public.fee_message_drafts force row level security;
revoke all on table public.fee_message_drafts from public, anon, authenticated;

drop trigger if exists fee_message_drafts_workspace_stamp on public.fee_message_drafts;
create trigger fee_message_drafts_workspace_stamp
before insert or update on public.fee_message_drafts
for each row execute function public.stamp_workspace_id();

do $$
begin
  if to_regclass('public.fee_message_drafts') is null
     or not exists (
       select 1 from pg_class
       where oid = 'public.fee_message_drafts'::regclass
         and relrowsecurity and relforcerowsecurity
     ) then
    raise exception '108 acceptance failed: fee message drafts are not secured';
  end if;
end $$;

commit;
