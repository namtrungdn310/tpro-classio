-- TPRO Classio — 051_schedule_availability_indexes.sql (Round 4 hardened)
--
-- Mục đích:
--   1. Preflight fail-fast validate toàn bộ schedule theo ĐÚNG contract runtime
--      (ClassScheduleSlot): JSON shape, day, mốc 30 phút trong 07:00-22:00,
--      buổi tối thiểu 60 phút, tối đa 4 slot, không overlap cùng ngày theo
--      interval nửa mở [start,end), teacher_ids/assistant_ids là array UUID
--      hợp lệ, không duplicate, không cross-role, tối đa 10 ID/role, explicit
--      assignment phải thuộc junction đúng role.
--   2. Diagnostic đúng nghĩa: total count CHÍNH XÁC + tối đa 20 class ID mẫu;
--      không exit loop ở 20, không LIMIT trước count(*).
--   3. Backfill teacher_ids cho slot legacy THIẾU/RỖNG theo pool giáo viên cấp
--      lớp (chỉ TEACHER; KHÔNG backfill trợ giảng, KHÔNG đụng slot explicit).
--   4. Backup persistent (KHÔNG ON DELETE CASCADE) lưu before/after
--      fingerprints BẤT BIẾN theo run identity (_m051_run): rerun không bao
--      giờ refresh fingerprint cũ; target mới trùng backup cũ -> abort.
--   5. Post-check dùng đúng run id, không dùng time-window.
--   6. Không tạo provider role; GRANT có điều kiện nếu role đã tồn tại.
--   7. KHÔNG tạo index mới: classes_operational_dates_idx (042) và
--      classes_category_operational_idx (044) đã phục vụ query lifecycle/date.
--
-- Rerun contract (đã chốt):
--   - Không còn class legacy target mới: no-op an toàn, không chạm backup cũ.
--   - Có target mới mà class đã có backup từ lần chạy trước: ABORT rõ ràng,
--     không tái sử dụng backup lịch sử cho mutation mới.
--
-- Áp dụng: psql -v ON_ERROR_STOP=1 -f 051_schedule_availability_indexes.sql
-- Rollback: scripts/051_schedule_availability_rollback.sql (abort khi drift).
-- Finalization: scripts/051_schedule_availability_acceptance.sql (sau smoke).

begin;

-- ---------------------------------------------------------------
-- Preflight 1: shape/time/limits/overlap/UUID - total + bounded sample.
-- ---------------------------------------------------------------
create temp table _m051_issues on commit drop as
  select c.id as class_id, 'schedule not object'::text as reason
    from public.classes c
   where c.schedule is not null
     and jsonb_typeof(c.schedule) <> 'object'
  union all
  select c.id, 'slots not array'
    from public.classes c
   where c.schedule is not null
     and jsonb_typeof(c.schedule) = 'object'
     and c.schedule ? 'slots'
     and jsonb_typeof(c.schedule -> 'slots') <> 'array'
  union all
  select c.id, 'more than 4 slots'
    from public.classes c
   where c.schedule is not null
     and jsonb_typeof(c.schedule) = 'object'
     and case
           when jsonb_typeof(c.schedule -> 'slots') = 'array'
           then jsonb_array_length(c.schedule -> 'slots') > 4
           else false
         end
  union all
  select distinct c.id, 'slot shape/time invalid'
    from public.classes c,
         jsonb_array_elements(
           case
             when jsonb_typeof(c.schedule -> 'slots') = 'array'
             then c.schedule -> 'slots'
             else '[]'::jsonb
           end
         ) slot
   where c.schedule is not null
     and jsonb_typeof(c.schedule) = 'object'
     and (
       jsonb_typeof(slot.value) <> 'object'
       or (slot.value ->> 'day') not in
          ('Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'Chủ Nhật')
       or (slot.value ->> 'start') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (slot.value ->> 'end') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
       or (split_part(slot.value ->> 'start', ':', 1))::int * 60
          + (split_part(slot.value ->> 'start', ':', 2))::int
          < 7 * 60
       or (split_part(slot.value ->> 'end', ':', 1))::int * 60
          + (split_part(slot.value ->> 'end', ':', 2))::int
          > 22 * 60
       or (split_part(slot.value ->> 'end', ':', 1))::int * 60
          + (split_part(slot.value ->> 'end', ':', 2))::int
          - (split_part(slot.value ->> 'start', ':', 1))::int * 60
          - (split_part(slot.value ->> 'start', ':', 2))::int
          < 60
                     or ((split_part(slot.value ->> 'start', ':', 1))::int * 60
          + (split_part(slot.value ->> 'start', ':', 2))::int) % 30 <> 0
       or ((split_part(slot.value ->> 'end', ':', 1))::int * 60
           + (split_part(slot.value ->> 'end', ':', 2))::int) % 30 <> 0
     )
  union all
  select distinct c.id, 'teacher_ids invalid'
    from public.classes c,
         jsonb_array_elements(
           case
             when jsonb_typeof(c.schedule -> 'slots') = 'array'
             then c.schedule -> 'slots'
             else '[]'::jsonb
           end
         ) slot
   where c.schedule is not null
     and jsonb_typeof(c.schedule) = 'object'
     and case
           when not (slot.value ? 'teacher_ids') then false
           when jsonb_typeof(slot.value -> 'teacher_ids') <> 'array' then true
           else (
             exists (
               select 1
                 from jsonb_array_elements_text(slot.value -> 'teacher_ids') t
                where t.value !~
                  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
             )
             or (select count(*) from jsonb_array_elements_text(slot.value -> 'teacher_ids')) > 10
             or exists (
               select 1
                 from jsonb_array_elements_text(slot.value -> 'teacher_ids')
                group by value
               having count(*) > 1
             )
           )
         end
  union all
  select distinct c.id, 'assistant_ids invalid'
    from public.classes c,
         jsonb_array_elements(
           case
             when jsonb_typeof(c.schedule -> 'slots') = 'array'
             then c.schedule -> 'slots'
             else '[]'::jsonb
           end
         ) slot
   where c.schedule is not null
     and jsonb_typeof(c.schedule) = 'object'
     and case
           when not (slot.value ? 'assistant_ids') then false
           when jsonb_typeof(slot.value -> 'assistant_ids') <> 'array' then true
           else (
             exists (
               select 1
                 from jsonb_array_elements_text(slot.value -> 'assistant_ids') a
                where a.value !~
                  '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
             )
             or (select count(*) from jsonb_array_elements_text(slot.value -> 'assistant_ids')) > 10
             or exists (
               select 1
                 from jsonb_array_elements_text(slot.value -> 'assistant_ids')
                group by value
               having count(*) > 1
             )
           )
         end
  union all
  select distinct c.id, 'cross-role id'
    from public.classes c,
         jsonb_array_elements(
           case
             when jsonb_typeof(c.schedule -> 'slots') = 'array'
             then c.schedule -> 'slots'
             else '[]'::jsonb
           end
         ) slot
   where c.schedule is not null
     and jsonb_typeof(c.schedule) = 'object'
     and slot.value ? 'teacher_ids'
     and slot.value ? 'assistant_ids'
     and exists (
       select 1
         from jsonb_array_elements_text(slot.value -> 'teacher_ids') t
         join jsonb_array_elements_text(slot.value -> 'assistant_ids') a
           on a.value = t.value
     )
  union all
  select distinct sa.class_id, 'overlap same day'
    from (
      select c.id as class_id, sl.value ->> 'day' as day,
             (split_part(sl.value ->> 'start', ':', 1))::int * 60
             + (split_part(sl.value ->> 'start', ':', 2))::int as s_min,
             (split_part(sl.value ->> 'end', ':', 1))::int * 60
             + (split_part(sl.value ->> 'end', ':', 2))::int as e_min,
             sl.value as slot_value
        from public.classes c,
             jsonb_array_elements(
               case
                 when jsonb_typeof(c.schedule -> 'slots') = 'array'
                 then c.schedule -> 'slots'
                 else '[]'::jsonb
               end
             ) sl
       where c.schedule is not null
         and jsonb_typeof(c.schedule) = 'object'
         and jsonb_typeof(sl.value) = 'object'
    ) sa
    join (
      select c.id as class_id, sl.value ->> 'day' as day,
             (split_part(sl.value ->> 'start', ':', 1))::int * 60
             + (split_part(sl.value ->> 'start', ':', 2))::int as s_min,
             (split_part(sl.value ->> 'end', ':', 1))::int * 60
             + (split_part(sl.value ->> 'end', ':', 2))::int as e_min,
             sl.value as slot_value
        from public.classes c,
             jsonb_array_elements(
               case
                 when jsonb_typeof(c.schedule -> 'slots') = 'array'
                 then c.schedule -> 'slots'
                 else '[]'::jsonb
               end
             ) sl
       where c.schedule is not null
         and jsonb_typeof(c.schedule) = 'object'
         and jsonb_typeof(sl.value) = 'object'
    ) sb
      on sa.class_id = sb.class_id
     and sa.day = sb.day
     and sa.s_min <= sb.s_min
     and sa.slot_value <> sb.slot_value
     and sa.s_min < sb.e_min
     and sb.s_min < sa.e_min;

-- Tách total count khỏi sample (max 20) — không LIMIT trước count(*).
do $$
declare
  bad_total bigint;
  bad_sample text[];
begin
  select count(distinct class_id) into bad_total from _m051_issues;
  if bad_total > 0 then
    select coalesce(array_agg(x), '{}'::text[])
      into bad_sample
      from (select distinct class_id::text as x from _m051_issues order by 1 limit 20) s;
    raise exception
      'M051 preflight failed: % class(es) invalid schedule (total; sample max 20): %',
      bad_total, bad_sample;
  end if;
  raise notice 'M051 preflight OK: shape/time/limits/overlap/UUIDs valid';
end $$;

-- ---------------------------------------------------------------
-- Preflight 2: explicit assignment phải thuộc junction đúng role.
-- Total + sample 20.
-- ---------------------------------------------------------------
create temp table _m051_junction_issues on commit drop as
  select distinct c.id as class_id
    from public.classes c,
         jsonb_array_elements(
           case
             when jsonb_typeof(c.schedule -> 'slots') = 'array'
             then c.schedule -> 'slots'
             else '[]'::jsonb
           end
         ) slot
   where c.schedule is not null
     and jsonb_typeof(c.schedule) = 'object'
     and (
       exists (
         select 1
           from jsonb_array_elements_text(slot.value -> 'teacher_ids') t
           left join public.class_teachers ct
             on ct.class_id = c.id
            and ct.teacher_id = t.value::uuid
           left join public.staff_members sm on sm.id = ct.teacher_id
          where slot.value ? 'teacher_ids'
            and t.value ~
              '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            and sm.staff_type is distinct from 'TEACHER'
       )
       or exists (
         select 1
           from jsonb_array_elements_text(slot.value -> 'assistant_ids') a
           left join public.class_teachers ct
             on ct.class_id = c.id
            and ct.teacher_id = a.value::uuid
           left join public.staff_members sm on sm.id = ct.teacher_id
          where slot.value ? 'assistant_ids'
            and a.value ~
              '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
            and sm.staff_type is distinct from 'ASSISTANT'
       )
     );

do $$
declare
  j_total bigint;
  j_sample text[];
begin
  select count(*) into j_total from _m051_junction_issues;
  if j_total > 0 then
    select coalesce(array_agg(x), '{}'::text[])
      into j_sample
      from (select class_id::text as x from _m051_junction_issues order by 1 limit 20) s;
    raise exception
      'M051 preflight failed: % class(es) explicit assignment outside junction/role (total; sample max 20): %',
      j_total, j_sample;
  end if;
  raise notice 'M051 preflight junction OK: explicit assignments match junction roles';
end $$;

-- ---------------------------------------------------------------
-- Backup table persistent với ACL khóa chặt.
-- run_id: identity của lần chạy đã tạo backup; fingerprint chỉ thuộc đúng
-- run; post-check/rollback join run này, không dùng time-window.
-- ---------------------------------------------------------------
create table if not exists public._migration_051_class_schedule_backup (
  class_id uuid primary key references public.classes(id) on delete restrict,
  run_id uuid not null default gen_random_uuid(),
  schedule_before jsonb not null,
  version_before bigint,
  updated_at_before timestamptz,
  schedule_after jsonb,
  version_after bigint,
  updated_at_after timestamptz,
  migrated_at timestamptz not null default now(),
  migration_version text not null default '051'
);

alter table public._migration_051_class_schedule_backup enable row level security;
alter table public._migration_051_class_schedule_backup force row level security;

drop policy if exists "m051_backup_no_access"
  on public._migration_051_class_schedule_backup;

revoke all on public._migration_051_class_schedule_backup
  from anon, authenticated, service_role, public;

-- Lưu ý: verify_security.sql yêu cầu ZERO policy trong schema public — bảng
-- backup chỉ truy cập được bởi OWNER (migration owner có BYPASSRLS như
-- supabase_admin deploy thật). Không tạo policy cho owner ở đây.

-- ---------------------------------------------------------------
-- Run identity + target: class có slot teacher thiếu/rỗng VÀ teacher hợp lệ.
-- ---------------------------------------------------------------
create temp table _m051_run on commit drop as
  select gen_random_uuid() as run_id;

create temp table _m051_target on commit drop as
  select c.id as class_id
    from public.classes c
   where c.schedule is not null
     and jsonb_typeof(c.schedule) = 'object'
     and jsonb_typeof(c.schedule -> 'slots') = 'array'
     and exists (
       select 1
         from jsonb_array_elements(c.schedule -> 'slots') slot
        where not (slot.value ? 'teacher_ids')
           or jsonb_array_length(coalesce(slot.value -> 'teacher_ids', '[]'::jsonb)) = 0
     )
     and exists (
       select 1
         from public.class_teachers ct
         join public.staff_members sm on sm.id = ct.teacher_id
        where ct.class_id = c.id
          and sm.staff_type = 'TEACHER'
     );

-- Legacy class thiếu teacher hợp lệ: fail-fast, total + sample 20.
do $$
declare
  broken_total bigint;
  broken_sample text[];
begin
  select count(*) into broken_total
    from public.classes c
   where c.schedule is not null
     and jsonb_typeof(c.schedule) = 'object'
     and jsonb_typeof(c.schedule -> 'slots') = 'array'
     and exists (
       select 1
         from jsonb_array_elements(c.schedule -> 'slots') slot
        where not (slot.value ? 'teacher_ids')
           or jsonb_array_length(coalesce(slot.value -> 'teacher_ids', '[]'::jsonb)) = 0
     )
     and not exists (
       select 1
         from public.class_teachers ct
         join public.staff_members sm on sm.id = ct.teacher_id
        where ct.class_id = c.id
          and sm.staff_type = 'TEACHER'
     );

  if broken_total > 0 then
    select coalesce(array_agg(x), '{}'::text[])
      into broken_sample
      from (
        select c.id::text as x
          from public.classes c
         where c.schedule is not null
           and jsonb_typeof(c.schedule) = 'object'
           and jsonb_typeof(c.schedule -> 'slots') = 'array'
           and exists (
             select 1
               from jsonb_array_elements(c.schedule -> 'slots') slot
              where not (slot.value ? 'teacher_ids')
                 or jsonb_array_length(coalesce(slot.value -> 'teacher_ids', '[]'::jsonb)) = 0
           )
           and not exists (
             select 1
               from public.class_teachers ct
               join public.staff_members sm on sm.id = ct.teacher_id
              where ct.class_id = c.id
                and sm.staff_type = 'TEACHER'
           )
         order by 1
         limit 20
      ) s;
    raise exception
      'M051 preflight failed: % legacy class(es) without valid teacher (total; sample max 20): %',
      broken_total, broken_sample;
  end if;

  raise notice 'M051 preflight target OK: no legacy class without a valid teacher';
end $$;

-- ---------------------------------------------------------------
-- Rerun contract: target mới trùng class đã backup (immutable) -> ABORT.
-- Backup cũ không bao giờ được tái sử dụng cho mutation mới.
-- ---------------------------------------------------------------
do $$
declare
  clash_total bigint;
  clash_sample text[];
begin
  select count(*) into clash_total
    from _m051_target t
    join public._migration_051_class_schedule_backup b on b.class_id = t.class_id;

  if clash_total > 0 then
    select coalesce(array_agg(x), '{}'::text[])
      into clash_sample
      from (select t.class_id::text as x from _m051_target t order by 1 limit 20) s;
    raise exception
      'M051 rerun aborted: % class(es) already backed up by a previous immutable run (sample max 20): %. Không tái sử dụng backup cũ cho mutation mới.',
      clash_total, clash_sample;
  end if;

  raise notice 'M051 rerun contract OK: no immutable-backup clash for new targets';
end $$;

-- ---------------------------------------------------------------
-- Backup schedule/version markers của ĐÚNG class target (run hiện tại).
-- ---------------------------------------------------------------
insert into public._migration_051_class_schedule_backup (
  class_id, run_id, schedule_before, version_before, updated_at_before
)
select c.id, r.run_id, c.schedule, c.version, c.updated_at
  from public.classes c
  join _m051_target t on t.class_id = c.id
  cross join _m051_run r;

-- ---------------------------------------------------------------
-- Backfill: chỉ slot thiếu/rỗng teacher_ids; thứ tự slot giữ nguyên bằng
-- WITH ORDINALITY; danh sách teacher sắp theo ID ổn định (ordered aggregate).
-- ---------------------------------------------------------------
update public.classes c
   set schedule = jsonb_set(
         c.schedule,
         '{slots}',
         (
           select jsonb_agg(
                    case
                      when not (slot.value ? 'teacher_ids')
                        or jsonb_array_length(
                             coalesce(slot.value -> 'teacher_ids', '[]'::jsonb)
                           ) = 0
                      then jsonb_set(
                             slot.value,
                             '{teacher_ids}',
                             (
                               select coalesce(
                                        jsonb_agg(
                                          to_jsonb(ct.teacher_id)
                                          order by ct.teacher_id
                                        ),
                                        '[]'::jsonb
                                      )
                                 from public.class_teachers ct
                                 join public.staff_members sm
                                   on sm.id = ct.teacher_id
                                where ct.class_id = c.id
                                  and sm.staff_type = 'TEACHER'
                             )
                           )
                      else slot.value
                    end
                    order by slot.ordinality
                  )
             from jsonb_array_elements(c.schedule -> 'slots')
             with ordinality as slot
         ),
         false
       )
 where c.id in (select class_id from _m051_target);

-- ---------------------------------------------------------------
-- After-fingerprint CHỈ CHO RUN HIỆN TẠI — backup lịch sử bất biến.
-- ---------------------------------------------------------------
update public._migration_051_class_schedule_backup b
   set schedule_after = c.schedule,
       version_after = c.version,
       updated_at_after = c.updated_at
  from public.classes c, _m051_run r
 where c.id = b.class_id
   and b.run_id = r.run_id;

-- ---------------------------------------------------------------
-- Post-check 1: không còn slot teacher missing/empty trong phạm vi backfill.
-- ---------------------------------------------------------------
do $$
declare
  remaining bigint;
begin
  select count(*)
    into remaining
    from public.classes c,
         jsonb_array_elements(
           case
             when jsonb_typeof(c.schedule -> 'slots') = 'array'
             then c.schedule -> 'slots'
             else '[]'::jsonb
           end
         ) as slot
   where c.schedule is not null
     and (
       not (slot.value ? 'teacher_ids')
       or jsonb_array_length(coalesce(slot.value -> 'teacher_ids', '[]'::jsonb)) = 0
     );

  if remaining > 0 then
    raise exception 'M051 post-check 1 failed: % slot(s) still missing teacher_ids', remaining;
  end if;

  raise notice 'M051 post-check 1 OK: no slot missing teacher_ids';
end $$;

-- ---------------------------------------------------------------
-- Post-check 2 (theo run id — KHÔNG time-window): target của lần chạy này
-- byte-equivalent với before (explicit teacher/assistant, order, slot count),
-- và fingerprint after khớp chính xác state hiện tại của classes.
-- ---------------------------------------------------------------
do $$
declare
  mismatch bigint;
  checked bigint;
  current_run uuid;
begin
  select r.run_id into current_run from _m051_run r;

  select count(*)
    into mismatch
    from public._migration_051_class_schedule_backup b
    join public.classes c on c.id = b.class_id
   where b.run_id = current_run
     and (
       (select count(*) from jsonb_array_elements(b.schedule_before -> 'slots'))
         <> (select count(*) from jsonb_array_elements(c.schedule -> 'slots'))
       or exists (
         select 1
           from jsonb_array_elements(b.schedule_before -> 'slots')
           with ordinality as before_slot
           join jsonb_array_elements(c.schedule -> 'slots')
             with ordinality as after_slot
             on after_slot.ordinality = before_slot.ordinality
          where (
             before_slot.value ? 'teacher_ids'
             and jsonb_array_length(
               coalesce(before_slot.value -> 'teacher_ids', '[]'::jsonb)
             ) > 0
             and before_slot.value -> 'teacher_ids'
               <> coalesce(after_slot.value -> 'teacher_ids', '[]'::jsonb)
          )
          or coalesce(before_slot.value -> 'assistant_ids', '[]'::jsonb)
            <> coalesce(after_slot.value -> 'assistant_ids', '[]'::jsonb)
       )
       or c.schedule is distinct from b.schedule_after
     );

  select count(*) into checked
    from public._migration_051_class_schedule_backup
   where run_id = current_run;

  if mismatch > 0 then
    raise exception
      'M051 post-check 2 failed: % class(es) with changed explicit/assistant/order or fingerprint drift',
      mismatch;
  end if;

  raise notice 'M051 post-check 2 OK: % backed-up class(es) of this run unchanged; fingerprints immutable', checked;
end $$;

commit;

-- =====================================================================
-- Rollback: chạy scripts/051_schedule_availability_rollback.sql (bản được
-- version-control, trong transaction riêng, abort nếu có drift).
-- Finalization: scripts/051_schedule_availability_acceptance.sql sau smoke.
-- =====================================================================
