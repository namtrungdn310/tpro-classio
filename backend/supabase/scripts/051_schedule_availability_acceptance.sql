-- TPRO Classio — scripts/051_schedule_availability_acceptance.sql
--
-- FINALIZATION backup migration 051 — chạy RIÊNG, chỉ sau khi:
--   - migration 051 + 052 đã áp dụng;
--   - verify_security.sql đạt;
--   - smoke test (app + log + latency) đạt;
--   - quyết định GIỮ migration đã được xác nhận thủ công.
--
-- Hành động:
--   1. Fail nếu 051 chưa chạy (backup table chưa tồn tại) hoặc còn backup row
--      mà class không khớp after-fingerprint (drift) — finalization chỉ hợp lệ
--      khi mọi backup row còn khớp trạng thái đã xác nhận.
--   2. Ghi NOTICE tổng backup row được dọn.
--   3. DROP backup table -> giải phóng FK `on delete restrict`; nghiệp vụ
--      delete-class hoạt động bình thường trở lại.
--
-- Sau khi chạy script này, rollback 051 KHÔNG còn khả dụng: không còn
-- backup để phục hồi. Đây là điểm bất khả hồi của finalization.
--
-- Áp dụng: psql -v ON_ERROR_STOP=1 -f scripts/051_schedule_availability_acceptance.sql

begin;

do $$
declare
  backup_rows bigint;
  drifted bigint;
  missing_class bigint;
begin
  if to_regclass('public._migration_051_class_schedule_backup') is null then
    raise exception 'M051 acceptance aborted: backup table missing — 051 chưa được áp dụng hoặc đã finalize';
  end if;

  select count(*) into backup_rows
    from public._migration_051_class_schedule_backup;

  -- Drift check như rollback: không được finalize khi dữ liệu lệch fingerprint.
  select count(*)
    into drifted
    from public._migration_051_class_schedule_backup b
    join public.classes c on c.id = b.class_id
   where b.schedule_after is not null
     and (
       c.schedule is distinct from b.schedule_after
       or (b.version_after is not null and c.version is distinct from b.version_after)
       or (b.updated_at_after is not null and c.updated_at is distinct from b.updated_at_after)
     );

  if drifted > 0 then
    raise exception 'M051 acceptance aborted: % class(es) drifted from after-fingerprint — resolve trước khi finalize', drifted;
  end if;

  select count(*) into missing_class
    from public._migration_051_class_schedule_backup b
    left join public.classes c on c.id = b.class_id
   where c.id is null;
  if missing_class > 0 then
    raise exception 'M051 acceptance aborted: % backup row(s) reference missing classes', missing_class;
  end if;

  raise notice 'M051 acceptance: % backup row(s) consistent; finalizing backup lifecycle', backup_rows;
end $$;

drop table public._migration_051_class_schedule_backup;

commit;

-- Sau finalization: delete-class workflow không còn bị FK backup chặn.
-- Rollback 051 không còn khả dụng (bất khả hồi) — nếu phát hiện lỗi sau đó
-- phải dùng dump/reconcile thủ công.
