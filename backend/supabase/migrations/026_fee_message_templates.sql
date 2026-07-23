-- Institution-wide Zalo templates keep fee communication consistent across
-- devices and administrators. The row is a versioned singleton so concurrent
-- edits cannot silently overwrite each other.
begin;

create table if not exists public.fee_message_templates (
  id smallint primary key default 1,
  payment_reminder_template text not null,
  payment_received_template text not null,
  version integer not null default 1,
  updated_by uuid references public.profiles(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint fee_message_templates_singleton_check check (id = 1),
  constraint fee_message_templates_version_check check (version >= 1),
  constraint fee_message_templates_reminder_length_check check (
    char_length(payment_reminder_template) between 20 and 1200
  ),
  constraint fee_message_templates_received_length_check check (
    char_length(payment_received_template) between 20 and 1200
  )
);

insert into public.fee_message_templates (
  id,
  payment_reminder_template,
  payment_received_template
)
values (
  1,
  $reminder$TPRO English xin thông báo học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Tổng học phí cần thanh toán: {{tong_tien}}.
{{nhac_qua_han}}Phụ huynh vui lòng thanh toán giúp trung tâm. Cảm ơn phụ huynh.$reminder$,
  $received$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh.$received$
)
on conflict (id) do nothing;

drop trigger if exists fee_message_templates_updated_at
  on public.fee_message_templates;
create trigger fee_message_templates_updated_at
before update on public.fee_message_templates
for each row execute function public.set_updated_at();

alter table public.fee_message_templates enable row level security;
alter table public.fee_message_templates force row level security;
revoke all privileges on table public.fee_message_templates
  from public, anon, authenticated;

comment on table public.fee_message_templates is
  'Versioned institution-wide plain-text templates for fee Zalo messages.';

commit;
