-- TPRO Classio — 052_class_staff_role_audit_snapshot.sql (Round 4)
--
-- Mục đích:
--   1. Thêm `staff_type_snapshot` (NOT NULL, check TEACHER|ASSISTANT) vào
--      `class_teacher_events` — role tại thời điểm event, CÓ NGUỒN CHỨNG CỨ.
--   2. KHÔNG backfill bằng `staff_members.staff_type` hiện tại một cách mù.
--      Phân loại event theo bằng chứng:
--      a) CÒN link `class_teachers` (hoặc `classes.teacher_id`): role tại
--         thời điểm event = role hiện tại — vì trigger
--         `enforce_staff_assignment_lifecycle` (050/052) chặn đổi role khi
--         staff còn assigned. Đây là bằng chứng vững.
--      b) CÓ mapping thủ công (file version-controlled
--         `supabase/scripts/052_role_snapshot_mapping.sql`, chỉ chứa
--         event_id + role, không PII): dùng mapping đã kiểm duyệt.
--      c) MƠ HỒ (staff tồn tại nhưng đã unassign và không có mapping):
--         MIGRATION ABORT với total + sample <= 20 — tuyệt đối không đoán.
--   3. Chặn đổi role ĐỐI XỨNG (TEACHER->khác và ASSISTANT->khác) khi nhân
--      sự còn bất kỳ link class_teachers hoặc còn là classes.teacher_id.
--
-- Rerun contract: cột/constraint đã tồn tại -> backfill WHERE snapshot IS
-- NULL (0 row) -> no-op an toàn; không tạo lại event history.
--
-- Áp dụng: psql -v ON_ERROR_STOP=1 -f 052_class_staff_role_audit_snapshot.sql
-- Mapping (nếu cần): chạy trước 052:
--   psql -v ON_ERROR_STOP=1 -f scripts/052_role_snapshot_mapping.sql

begin;

-- Default ACL của migration owner: function mới KHÔNG được public-execute
-- (verify: acldefault('f', owner) mặc định grant EXECUTE to PUBLIC).
alter default privileges
  revoke execute on functions from public, anon, authenticated;

-- ---------------------------------------------------------------
-- Cột snapshot (nullable để backfill trong cùng transaction) — tạo sớm để
-- preflight phân loại event chưa có snapshot.
-- ---------------------------------------------------------------
alter table public.class_teacher_events
  add column if not exists staff_type_snapshot text;

-- Lưu ý: verify_security.sql yêu cầu ZERO policy trong schema public —
-- migration owner (BYPASSRLS như supabase_admin deploy thật) truy cập bảng
-- qua ownership; anon/authenticated/runtime vẫn deny (FORCE RLS + revoke).

-- ---------------------------------------------------------------
-- Preflight 1: event tham chiếu staff không tồn tại -> abort (total + 20).
-- ---------------------------------------------------------------
do $$
declare
  missing_total bigint;
  missing_sample text[];
begin
  select count(*)
    into missing_total
    from public.class_teacher_events e
    left join public.staff_members s on s.id = e.teacher_id
   where s.id is null;

  if missing_total > 0 then
    select coalesce(array_agg(x), '{}'::text[])
      into missing_sample
      from (
        select e.id::text as x
          from public.class_teacher_events e
          left join public.staff_members s on s.id = e.teacher_id
         where s.id is null
         order by 1
         limit 20
      ) s;
    raise exception
      'M052 preflight failed: % event(s) reference missing staff (total; sample max 20): %',
      missing_total, missing_sample;
  end if;

  raise notice 'M052 preflight 1 OK: no event references missing staff';
end $$;

-- ---------------------------------------------------------------
-- Preflight 2: phân loại event CHƯA có snapshot theo bằng chứng.
--   certain   = staff đang còn link (class_teachers hoặc classes.teacher_id)
--   mapped    = có row trong _m052_role_snapshot_mapping
--   ambiguous = không đủ bằng chứng -> ABORT total + sample 20.
-- ---------------------------------------------------------------
do $$
declare
  ambiguous_total bigint;
  ambiguous_sample text[];
begin
  if to_regclass('public._m052_role_snapshot_mapping') is not null then
    select count(*)
      into ambiguous_total
      from public.class_teacher_events e
      join public.staff_members s on s.id = e.teacher_id
     where e.staff_type_snapshot is null
       and not exists (
         select 1
           from public.class_teachers link
          where link.class_id = e.class_id
            and link.teacher_id = e.teacher_id
       )
       and not exists (
         select 1
           from public.classes class_
          where class_.id = e.class_id
            and class_.teacher_id = e.teacher_id
       )
       and not exists (
         select 1
           from public._m052_role_snapshot_mapping m
          where m.event_id = e.id
       );
  else
    select count(*)
      into ambiguous_total
      from public.class_teacher_events e
      join public.staff_members s on s.id = e.teacher_id
     where e.staff_type_snapshot is null
       and not exists (
         select 1
           from public.class_teachers link
          where link.class_id = e.class_id
            and link.teacher_id = e.teacher_id
       )
       and not exists (
         select 1
           from public.classes class_
          where class_.id = e.class_id
            and class_.teacher_id = e.teacher_id
       );
  end if;

  if ambiguous_total > 0 then
    if to_regclass('public._m052_role_snapshot_mapping') is not null then
      select coalesce(array_agg(x), '{}'::text[])
        into ambiguous_sample
        from (
          select e.id::text as x
            from public.class_teacher_events e
            join public.staff_members s on s.id = e.teacher_id
           where e.staff_type_snapshot is null
             and not exists (
               select 1
                 from public.class_teachers link
                where link.class_id = e.class_id
                  and link.teacher_id = e.teacher_id
             )
             and not exists (
               select 1
                 from public.classes class_
                where class_.id = e.class_id
                  and class_.teacher_id = e.teacher_id
             )
             and not exists (
               select 1
                 from public._m052_role_snapshot_mapping m
                where m.event_id = e.id
             )
           order by 1
           limit 20
        ) s;
    else
      select coalesce(array_agg(x), '{}'::text[])
        into ambiguous_sample
        from (
          select e.id::text as x
            from public.class_teacher_events e
            join public.staff_members s on s.id = e.teacher_id
           where e.staff_type_snapshot is null
             and not exists (
               select 1
                 from public.class_teachers link
                where link.class_id = e.class_id
                  and link.teacher_id = e.teacher_id
             )
             and not exists (
               select 1
                 from public.classes class_
                where class_.id = e.class_id
                  and class_.teacher_id = e.teacher_id
             )
           order by 1
           limit 20
        ) s;
    end if;
    raise exception
      'M052 preflight failed: % ambiguous event(s) without evidence (total; sample max 20): %. Tạo scripts/052_role_snapshot_mapping.sql (event_id, role) rồi chạy lại — KHÔNG đoán role bằng current staff.',
      ambiguous_total, ambiguous_sample;
  end if;

  raise notice 'M052 preflight 2 OK: every event has evidence (current-link or mapping)';
end $$;

-- ---------------------------------------------------------------
-- Backfill 1: staff còn link -> role hiện tại (bằng chứng vững: role không
-- đổi được khi còn assigned).
--
-- Append-only trigger (047) tạm tháo trong transaction này để backfill cột
-- snapshot mới — trigger được tạo LẠI ngay sau đó (bên dưới); nếu bất kỳ
-- bước nào fail, transaction rollback khôi phục trigger nguyên trạng.
-- ---------------------------------------------------------------
drop trigger if exists trg_class_teacher_events_append_only
  on public.class_teacher_events;
drop trigger if exists trg_class_teacher_events_truncate
  on public.class_teacher_events;

update public.class_teacher_events e
   set staff_type_snapshot = s.staff_type
  from public.staff_members s
 where s.id = e.teacher_id
   and e.staff_type_snapshot is null
   and s.staff_type in ('TEACHER', 'ASSISTANT')
   and (
     exists (
       select 1
         from public.class_teachers link
        where link.class_id = e.class_id
          and link.teacher_id = e.teacher_id
     )
     or exists (
       select 1
         from public.classes class_
        where class_.id = e.class_id
          and class_.teacher_id = e.teacher_id
     )
   );

-- ---------------------------------------------------------------
-- Backfill 2: mapping thủ công (version-controlled, không PII).
-- ---------------------------------------------------------------
do $$
begin
  if to_regclass('public._m052_role_snapshot_mapping') is not null then
    update public.class_teacher_events e
       set staff_type_snapshot = m.role
      from public._m052_role_snapshot_mapping m
     where m.event_id = e.id
       and e.staff_type_snapshot is null;
  end if;
end $$;

-- ---------------------------------------------------------------
-- Post-check: mọi event phải có snapshot; constraint + check.
-- ---------------------------------------------------------------
do $$
declare
  remaining bigint;
  bad_role bigint;
begin
  select count(*) into remaining
    from public.class_teacher_events
   where staff_type_snapshot is null;
  if remaining > 0 then
    raise exception 'M052 backfill failed: % event(s) still missing staff_type_snapshot', remaining;
  end if;

  select count(*) into bad_role
    from public.class_teacher_events
   where staff_type_snapshot not in ('TEACHER', 'ASSISTANT');
  if bad_role > 0 then
    raise exception 'M052 backfill failed: % event(s) with invalid snapshot role', bad_role;
  end if;

  raise notice 'M052 backfill OK: all events snapshotted from evidence';
end $$;

alter table public.class_teacher_events
  alter column staff_type_snapshot set not null;

alter table public.class_teacher_events
  drop constraint if exists class_teacher_events_staff_type_snapshot_check;
alter table public.class_teacher_events
  add constraint class_teacher_events_staff_type_snapshot_check
  check (staff_type_snapshot in ('TEACHER', 'ASSISTANT'));

-- ---------------------------------------------------------------
-- Tạo LẠI append-only protection (047) cho bảng events — bảo vệ cả cột
-- snapshot mới: update/delete/truncate vẫn bị chặn sau migration.
-- Function block_class_teacher_event_mutation() đã tồn tại từ 047 — chỉ
-- drop/recreate trigger (create or replace function cần ownership của hàm,
-- không nằm trong quyền migration owner không phải chủ sở hữu hàm).
-- ---------------------------------------------------------------
drop trigger if exists trg_class_teacher_events_append_only
  on public.class_teacher_events;
create trigger trg_class_teacher_events_append_only
before update or delete on public.class_teacher_events
for each row execute function public.block_class_teacher_event_mutation();

drop trigger if exists trg_class_teacher_events_truncate
  on public.class_teacher_events;
create trigger trg_class_teacher_events_truncate
before truncate on public.class_teacher_events
for each statement execute function public.block_class_teacher_event_mutation();

-- ---------------------------------------------------------------
-- Role-change guard đối xứng: nhân sự còn bất kỳ link assignment (class_teachers
-- hoặc classes.teacher_id) không được đổi role theo bất kỳ chiều nào. Rules
-- deactivation theo lớp active vẫn giữ nguyên.
-- ---------------------------------------------------------------
create or replace function public.enforce_staff_assignment_lifecycle()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
declare
  target_id uuid := coalesce(new.id, old.id);
begin
  if tg_op = 'DELETE' then
    raise exception 'staff records must be archived instead of deleted';
  end if;

  if old.staff_type <> new.staff_type then
    if exists (
      select 1 from public.class_teachers link
      where link.teacher_id = target_id
    ) or exists (
      select 1 from public.classes class_
      where class_.teacher_id = target_id
    ) then
      raise exception 'assigned staff cannot change role while still assigned to a class';
    end if;
  end if;

  if old.is_active
     and not new.is_active
     and (
       exists (
         select 1
         from public.class_teachers link
         join public.classes class_ on class_.id = link.class_id
         where link.teacher_id = target_id
           and class_.is_active
       )
       or exists (
         select 1
         from public.classes class_
         where class_.teacher_id = target_id
           and class_.is_active
       )
     ) then
    raise exception 'assigned staff on an active class cannot be deactivated';
  end if;

  return new;
end
$$;

drop trigger if exists staff_members_assignment_lifecycle
  on public.staff_members;
create trigger staff_members_assignment_lifecycle
before update of staff_type, is_active or delete
on public.staff_members
for each row execute function public.enforce_staff_assignment_lifecycle();

-- Hàm guard không được public-execute (verify: new functions must not grant
-- EXECUTE to PUBLIC by default).
revoke all on function public.enforce_staff_assignment_lifecycle()
  from public, anon, authenticated;

commit;

-- Rollback (thủ công, transaction riêng):
--   begin;
--   alter table public.class_teacher_events
--     drop constraint if exists class_teacher_events_staff_type_snapshot_check;
--   alter table public.class_teacher_events
--     alter column staff_type_snapshot drop not null;
--   alter table public.class_teacher_events
--     drop column if exists staff_type_snapshot;
--   commit;
