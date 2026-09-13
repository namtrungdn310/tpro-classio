-- TPRO Classio — scripts/051_schedule_availability_rollback.sql
--
-- Rollback migration 051 — AN TOÀN: abort toàn bộ nếu class đã thay đổi sau
-- backfill (schedule/version/updated_at lệch fingerprint `schedule_after`).
-- Không bao giờ ghi đè thay đổi hợp lệ sau migration; nếu có drift phải dùng
-- dump/reconcile thủ công.
--
-- Maintenance window: không create/update/delete class từ lúc dump đến khi
-- smoke test và quyết định giữ/rollback hoàn tất.
--
-- Contract:
--   - Drift diagnostic: total CHÍNH XÁC + sample tối đa 20 (không LIMIT
--     trước count(*)).
--   - Restore exact before-state: schedule + version + updated_at.
--   - Sau restore, xóa backup rows đã hoàn tác để re-apply 051 không bị
--     immutable-backup clash; rollback -> reapply phải đạt.
--
-- Áp dụng: psql -v ON_ERROR_STOP=1 -f scripts/051_schedule_availability_rollback.sql

begin;

-- ---------------------------------------------------------------
-- Preflight drift: nếu BẤT KỲ class nào trong backup lệch fingerprint sau
-- backfill (đã bị sửa bởi nghiệp vụ), rollback không an toàn -> abort toàn bộ.
-- ---------------------------------------------------------------
do $$
declare
  drifted bigint;
  drifted_sample text[];
  missing_class bigint;
begin
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
    select coalesce(array_agg(x), '{}'::text[])
      into drifted_sample
      from (
        select c.id::text as x
          from public._migration_051_class_schedule_backup b
          join public.classes c on c.id = b.class_id
         where b.schedule_after is not null
           and (
             c.schedule is distinct from b.schedule_after
             or (b.version_after is not null and c.version is distinct from b.version_after)
             or (b.updated_at_after is not null and c.updated_at is distinct from b.updated_at_after)
           )
         order by 1
         limit 20
      ) s;
    raise exception
      'M051 rollback aborted: % class(es) changed after migration (total; sample max 20): %. Dùng dump/reconcile thủ công; không rollback mù.',
      drifted, drifted_sample;
  end if;

  -- Class bị xóa sau migration (backup còn nhưng class mất): với FK RESTRICT
  -- điều này chỉ xảy ra nếu backup bị xóa thủ công — abort để không rollback thiếu.
  select count(*) into missing_class
    from public._migration_051_class_schedule_backup b
    left join public.classes c on c.id = b.class_id
   where c.id is null;
  if missing_class > 0 then
    raise exception
      'M051 rollback aborted: % backup row(s) reference missing classes',
      missing_class;
  end if;

  raise notice 'M051 rollback preflight OK: no drift detected';
end $$;

-- ---------------------------------------------------------------
-- Khôi phục exact before-state (schedule + version + updated_at).
--
-- Trigger classes_enforce_lifecycle_integrity (042) bump version/updated_at
-- trên MỌI update classes; tạm tháo trong transaction này để restore đúng
-- before-state, rồi tạo lại ngay. Nếu bất kỳ bước nào fail, transaction
-- rollback khôi phục trigger nguyên trạng.
-- ---------------------------------------------------------------
drop trigger if exists classes_enforce_lifecycle_integrity
  on public.classes;

update public.classes c
   set schedule = b.schedule_before,
       version = b.version_before,
       updated_at = b.updated_at_before
  from public._migration_051_class_schedule_backup b
 where b.class_id = c.id;

drop trigger if exists classes_enforce_lifecycle_integrity
  on public.classes;
create trigger classes_enforce_lifecycle_integrity
before update on public.classes
for each row execute function public.enforce_class_lifecycle_integrity();

-- ---------------------------------------------------------------
-- Post-check: mọi class trong backup khớp exact schedule_before/version_before/
-- updated_at_before.
-- ---------------------------------------------------------------
do $$
declare
  mismatch bigint;
begin
  select count(*)
    into mismatch
    from public._migration_051_class_schedule_backup b
    join public.classes c on c.id = b.class_id
   where c.schedule is distinct from b.schedule_before
      or c.version is distinct from b.version_before
      or c.updated_at is distinct from b.updated_at_before;

  if mismatch > 0 then
    raise exception 'M051 rollback post-check failed: % class(es) not restored exactly', mismatch;
  end if;

  raise notice 'M051 rollback OK: all backed-up classes restored to exact before-state';
end $$;

-- ---------------------------------------------------------------
-- Dọn backup đã hoàn tác: re-apply 051 (T-DB051-044) không được bị
-- immutable-backup clash sau rollback.
-- ---------------------------------------------------------------
delete from public._migration_051_class_schedule_backup;

commit;

-- Sau rollback: lớp/buổi ở trạng thái trước 051. Muốn quay lại trạng thái
-- canonical thì re-apply 051 (backup mới, run mới). Không có backup cũ sót lại.
