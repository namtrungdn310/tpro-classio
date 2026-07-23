-- Split class/amount and due-date data into explicit tokens. Existing custom
-- templates are upgraded in place while retaining optimistic-lock semantics.
begin;

alter table public.fee_message_templates
  drop constraint if exists fee_message_templates_reminder_length_check;
alter table public.fee_message_templates
  add constraint fee_message_templates_reminder_length_check check (
    char_length(payment_reminder_template) between 20 and 1400
  );
alter table public.fee_message_templates
  drop constraint if exists fee_message_templates_received_length_check;
alter table public.fee_message_templates
  add constraint fee_message_templates_received_length_check check (
    char_length(payment_received_template) between 20 and 1400
  );

update public.fee_message_templates
set
  payment_reminder_template = replace(
    case
      when position('{{ngay_den_han}}' in payment_reminder_template) = 0 then
        replace(
          payment_reminder_template,
          '{{chi_tiet_hoc_phi}}',
          E'{{chi_tiet_hoc_phi}}\nNgày đến hạn: {{ngay_den_han}}.'
        )
      else payment_reminder_template
    end,
    '{{nhac_qua_han}}',
    ''
  ),
  payment_received_template = case
    when position('{{ngay_den_han}}' in payment_received_template) = 0 then
      replace(
        payment_received_template,
        '{{chi_tiet_hoc_phi}}',
        E'{{chi_tiet_hoc_phi}}\nNgày đến hạn: {{ngay_den_han}}.'
      )
    else payment_received_template
  end,
  version = case
    when version < 2147483647 then version + 1
    else version
  end
where
  position('{{nhac_qua_han}}' in payment_reminder_template) > 0
  or position('{{ngay_den_han}}' in payment_reminder_template) = 0
  or position('{{ngay_den_han}}' in payment_received_template) = 0;

commit;
