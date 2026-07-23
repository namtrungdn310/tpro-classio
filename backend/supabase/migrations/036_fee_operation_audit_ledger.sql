begin;

create table if not exists public.fee_operations (
    id uuid primary key default gen_random_uuid(),
    sequence_no bigint generated always as identity unique,
    action text not null check (action in (
        'notify',
        'unnotify',
        'payment',
        'payment_reversal',
        'refund',
        'refund_reversal',
        'sync',
        'template_update'
    )),
    origin text not null default 'application' check (origin in ('application', 'migration', 'system')),
    request_id uuid,
    period text check (period is null or period ~ '^\d{4}-\d{2}$'),
    business_date date not null default current_date,
    occurred_at timestamptz not null default now(),
    actor_user_id uuid references public.profiles(id) on delete set null,
    actor_name_snapshot text,
    actor_username_snapshot text,
    actor_role_snapshot text,
    item_count integer not null default 0 check (item_count >= 0),
    total_amount numeric(12, 0) not null default 0,
    schema_version smallint not null default 1 check (schema_version = 1)
);

create table if not exists public.fee_operation_items (
    id uuid primary key default gen_random_uuid(),
    operation_id uuid not null references public.fee_operations(id) on delete restrict,
    ordinal smallint not null check (ordinal > 0),
    fee_record_id uuid,
    enrollment_id uuid,
    student_id uuid,
    student_name_snapshot text,
    class_id uuid,
    class_name_snapshot text,
    period text check (period is null or period ~ '^\d{4}-\d{2}$'),
    state_before text,
    state_after text,
    amount_before numeric(12, 0),
    amount_after numeric(12, 0),
    amount_delta numeric(12, 0) not null default 0,
    due_date_before date,
    due_date_after date,
    payment_method text check (payment_method is null or payment_method in ('bank_transfer', 'cash')),
    notification_channel text,
    message_snapshot text,
    reason_snapshot text,
    payment_id uuid references public.payments(id) on delete restrict,
    related_payment_id uuid references public.payments(id) on delete restrict,
    unique (operation_id, ordinal)
);

create unique index if not exists ux_fee_operations_request_action
    on public.fee_operations(request_id, action)
    where request_id is not null and origin = 'application';
create index if not exists ix_fee_operations_cursor
    on public.fee_operations(occurred_at desc, sequence_no desc);
create index if not exists ix_fee_operations_action_cursor
    on public.fee_operations(action, occurred_at desc, sequence_no desc);
create index if not exists ix_fee_operations_actor_cursor
    on public.fee_operations(actor_user_id, occurred_at desc, sequence_no desc)
    where actor_user_id is not null;
create index if not exists ix_fee_operations_period_cursor
    on public.fee_operations(period, occurred_at desc, sequence_no desc)
    where period is not null;
create index if not exists ix_fee_operation_items_operation
    on public.fee_operation_items(operation_id, ordinal);
create index if not exists ix_fee_operation_items_student
    on public.fee_operation_items(student_id, operation_id)
    where student_id is not null;
create index if not exists ix_fee_operation_items_class
    on public.fee_operation_items(class_id, operation_id)
    where class_id is not null;
create unique index if not exists ux_fee_operation_items_payment
    on public.fee_operation_items(payment_id)
    where payment_id is not null;

create or replace function public.block_fee_operation_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
    raise exception 'fee operation ledger is append-only' using errcode = '42501';
end;
$$;

revoke execute on function public.block_fee_operation_mutation()
    from public, anon, authenticated;

drop trigger if exists trg_fee_operations_append_only on public.fee_operations;
create trigger trg_fee_operations_append_only
before update or delete or truncate on public.fee_operations
for each statement execute function public.block_fee_operation_mutation();

drop trigger if exists trg_fee_operation_items_append_only on public.fee_operation_items;
create trigger trg_fee_operation_items_append_only
before update or delete or truncate on public.fee_operation_items
for each statement execute function public.block_fee_operation_mutation();

alter table public.fee_operations enable row level security;
alter table public.fee_operations force row level security;
alter table public.fee_operation_items enable row level security;
alter table public.fee_operation_items force row level security;

revoke all on table public.fee_operations from public, anon, authenticated;
revoke all on table public.fee_operation_items from public, anon, authenticated;
revoke all on sequence public.fee_operations_sequence_no_seq from public, anon, authenticated;

-- Preserve the financial trail that predates this migration without inventing
-- an actor or pretending that notification history can be reconstructed.
insert into public.fee_operations (
    id,
    action,
    origin,
    request_id,
    period,
    business_date,
    occurred_at,
    actor_user_id,
    actor_name_snapshot,
    actor_username_snapshot,
    actor_role_snapshot,
    item_count,
    total_amount
)
select
    p.id,
    p.entry_type,
    'migration',
    p.idempotency_key,
    fr.period,
    p.payment_date,
    p.created_at,
    p.created_by,
    coalesce(pr.full_name, pr.username),
    pr.username,
    pr.role::text,
    1,
    p.amount
from public.payments p
join public.fee_records fr on fr.id = p.fee_record_id
left join public.profiles pr on pr.id = p.created_by
where not exists (
    select 1
    from public.fee_operation_items foi
    where foi.payment_id = p.id
);

insert into public.fee_operation_items (
    operation_id,
    ordinal,
    fee_record_id,
    enrollment_id,
    student_id,
    student_name_snapshot,
    class_id,
    class_name_snapshot,
    period,
    state_before,
    state_after,
    amount_before,
    amount_after,
    amount_delta,
    due_date_before,
    due_date_after,
    payment_method,
    message_snapshot,
    reason_snapshot,
    payment_id,
    related_payment_id
)
select
    fo.id,
    1,
    fr.id,
    fr.enrollment_id,
    e.student_id,
    coalesce(fr.student_name_snapshot, s.full_name),
    e.class_id,
    coalesce(fr.class_name_snapshot, c.name),
    fr.period,
    null,
    case p.entry_type
        when 'payment' then 'PAID'
        when 'payment_reversal' then 'UNPAID'
        when 'refund' then 'REFUNDED'
        when 'refund_reversal' then 'PAID'
    end,
    null,
    fr.final_amount,
    p.amount,
    fr.due_date,
    fr.due_date,
    p.payment_method::text,
    case when p.entry_type in ('payment', 'payment_reversal') then p.note end,
    case when p.entry_type in ('refund', 'refund_reversal') then p.note end,
    p.id,
    p.related_payment_id
from public.fee_operations fo
join public.payments p
  on fo.id = p.id
 and fo.origin = 'migration'
join public.fee_records fr on fr.id = p.fee_record_id
join public.enrollments e on e.id = fr.enrollment_id
join public.students s on s.id = e.student_id
join public.classes c on c.id = e.class_id
where not exists (
    select 1
    from public.fee_operation_items foi
    where foi.payment_id = p.id
);

commit;
