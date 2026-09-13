-- Operational reconciliation state for Pay2S deliveries that cannot be posted
-- automatically. Provider deliveries remain append-only; mutable review state
-- lives in payment_posting_queue and is workspace-isolated.

begin;

alter table public.payment_posting_queue
  add column if not exists transaction_snapshot jsonb not null default '{}'::jsonb,
  add column if not exists resolution text,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid references public.profiles(id) on delete set null;

create unique index if not exists payment_posting_queue_delivery_uniq
  on public.payment_posting_queue (delivery_id);

create index if not exists payment_posting_queue_workspace_review_idx
  on public.payment_posting_queue (workspace_id, status, created_at desc);

update public.payment_posting_queue
   set resolved_at = coalesce(resolved_at, created_at),
       resolution = coalesce(resolution, 'legacy_terminal_state')
 where status in ('POSTED', 'DEAD')
   and resolved_at is null;

alter table public.payment_posting_queue
  drop constraint if exists payment_posting_queue_resolution_shape;
alter table public.payment_posting_queue
  add constraint payment_posting_queue_resolution_shape check (
    (status in ('PENDING', 'PROCESSING', 'REVIEW')
      and resolved_at is null and resolved_by is null)
    or
    (status in ('POSTED', 'DEAD') and resolved_at is not null)
  ) not valid;
alter table public.payment_posting_queue
  validate constraint payment_posting_queue_resolution_shape;

revoke all on table public.payment_posting_queue from public, anon, authenticated;

commit;
