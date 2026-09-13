-- Keep the default Zalo templates visually stable across editor widths.
-- Only untouched system defaults are upgraded; workspace-customized content
-- is preserved byte-for-byte.
begin;

update public.fee_message_templates
set
  payment_reminder_template = case
    when payment_reminder_template = $old_reminder$TPRO English xin thông báo học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí cần thanh toán: {{tong_tien}}.
Phụ huynh vui lòng thanh toán giúp trung tâm. Cảm ơn phụ huynh.$old_reminder$
    then $new_reminder$TPRO English xin thông báo học phí {{ky_hoc_phi}} của em
{{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí cần thanh toán: {{tong_tien}}.
Phụ huynh vui lòng thanh toán giúp trung tâm. Cảm ơn phụ huynh.$new_reminder$
    else payment_reminder_template
  end,
  payment_received_template = case
    when payment_received_template = $old_received$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh.$old_received$
    then $new_received$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em
{{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh.$new_received$
    else payment_received_template
  end,
  version = case
    when version < 2147483647 then version + 1
    else version
  end,
  updated_at = now()
where payment_reminder_template = $match_reminder$TPRO English xin thông báo học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí cần thanh toán: {{tong_tien}}.
Phụ huynh vui lòng thanh toán giúp trung tâm. Cảm ơn phụ huynh.$match_reminder$
   or payment_received_template = $match_received$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh.$match_received$;

do $$
begin
  if exists (
    select 1
    from public.fee_message_templates
    where payment_reminder_template = $old_reminder$TPRO English xin thông báo học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí cần thanh toán: {{tong_tien}}.
Phụ huynh vui lòng thanh toán giúp trung tâm. Cảm ơn phụ huynh.$old_reminder$
       or payment_received_template = $old_received$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh.$old_received$
  ) then
    raise exception '105 acceptance failed: an untouched Zalo default was not upgraded';
  end if;
end $$;

commit;
