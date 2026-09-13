-- 088 — explicit Admin-to-parent payment request sharing audit.
-- Creating a QR/request is not sending it.  Every explicit share/copy action
-- gets an idempotent append-only event so the UI can explain what happened.

begin;

alter table public.payment_requests
  add column if not exists sent_channel text,
  add column if not exists send_count smallint not null default 0;

alter table public.payment_requests
  drop constraint if exists payment_requests_sent_channel_check;
alter table public.payment_requests
  add constraint payment_requests_sent_channel_check
    check (sent_channel is null or sent_channel in (
      'zalo_manual', 'copy_message', 'download_qr', 'share_link', 'other'
    ));

alter table public.payment_requests
  drop constraint if exists payment_requests_send_count_check;
alter table public.payment_requests
  add constraint payment_requests_send_count_check
    check (send_count >= 0);

alter table public.payment_request_events
  add column if not exists idempotency_key uuid,
  add column if not exists event_metadata jsonb not null default '{}'::jsonb;

create unique index if not exists payment_request_events_idempotency_key_uniq
  on public.payment_request_events (idempotency_key)
  where idempotency_key is not null;

alter table public.payment_request_events
  drop constraint if exists payment_request_events_event_metadata_object_check;
alter table public.payment_request_events
  add constraint payment_request_events_event_metadata_object_check
    check (jsonb_typeof(event_metadata) = 'object');

revoke all on table public.payment_request_events from public, anon, authenticated;

commit;
