-- Keep the receipt message aligned with the current six-line workflow:
-- acknowledgement stays on its own final line and is branded consistently
-- with the reminder message. Only the untouched 105 default is changed;
-- workspace-authored text is never overwritten.
begin;

update public.fee_message_templates
set
  payment_received_template = $new_received$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em
{{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
TPRO English cảm ơn phụ huynh.$new_received$,
  version = case
    when version < 2147483647 then version + 1
    else version
  end,
  updated_at = now()
where payment_received_template = $old_received$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em
{{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh.$old_received$;

do $$
begin
  if exists (
    select 1
    from public.fee_message_templates
    where payment_received_template = $old_received$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em
{{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh.$old_received$
  ) then
    raise exception '106 acceptance failed: receipt default was not updated';
  end if;
end $$;

commit;
