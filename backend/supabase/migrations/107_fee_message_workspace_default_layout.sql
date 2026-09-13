-- Repair workspace-scoped rows that were created after migration 105 or were
-- not present when 105/106 ran.  Only exact untouched system defaults are
-- changed; administrator-authored templates remain byte-for-byte unchanged.
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
    when payment_received_template in (
      $old_received$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh.$old_received$,
      $intermediate_received$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em
{{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh.$intermediate_received$
    )
    then $new_received$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em
{{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
TPRO English cảm ơn phụ huynh.$new_received$
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
   or payment_received_template in (
      $match_received_old$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh.$match_received_old$,
      $match_received_intermediate$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em
{{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh.$match_received_intermediate$
   );

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
       or payment_received_template in (
          $old_received$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em {{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh.$old_received$,
          $intermediate_received$TPRO English xác nhận đã nhận học phí {{ky_hoc_phi}} của em
{{ten_hoc_vien}}:
{{chi_tiet_hoc_phi}}
Ngày đến hạn: {{ngay_den_han}}.
Tổng học phí đã nhận: {{tong_tien}}.
Cảm ơn phụ huynh.$intermediate_received$
       )
  ) then
    raise exception '107 acceptance failed: an untouched Zalo default remains';
  end if;
end $$;

commit;
