-- Keep staff as operational teaching records rather than authentication
-- identities. Contact details use the same complete Zalo/phone pair as
-- students, while the obsolete email/account linkage is removed.

begin;

alter table public.staff_members
  add column if not exists zalo_name text;

update public.staff_members
set zalo_name = left(btrim(full_name), 100)
where phone is not null
  and nullif(btrim(zalo_name), '') is null;

update public.staff_members
set zalo_name = null
where phone is null
  and nullif(btrim(zalo_name), '') is null;

update public.staff_members
set zalo_name = btrim(zalo_name)
where zalo_name is not null;

do $$
begin
  if exists (
    select 1
    from public.staff_members
    where (zalo_name is null) <> (phone is null)
  ) then
    raise exception 'staff_members contains an incomplete Zalo/phone contact pair';
  end if;

  if exists (
    select 1
    from public.staff_members
    where zalo_name is not null
      and char_length(zalo_name) not between 1 and 100
  ) then
    raise exception 'staff_members contains an invalid Zalo name';
  end if;
end
$$;

drop index if exists public.ux_staff_members_auth_user_id;
drop index if exists public.ux_staff_members_email;

alter table public.staff_members
  drop constraint if exists staff_members_auth_user_id_fkey,
  drop constraint if exists staff_members_email_canonical_check,
  drop constraint if exists staff_members_zalo_name_length_check,
  drop constraint if exists staff_members_contact_pair_check,
  drop column if exists auth_user_id,
  drop column if exists email;

alter table public.staff_members
  add constraint staff_members_zalo_name_length_check
    check (
      zalo_name is null
      or (
        char_length(zalo_name) between 1 and 100
        and zalo_name = btrim(zalo_name)
      )
    ),
  add constraint staff_members_contact_pair_check
    check ((zalo_name is null) = (phone is null));

commit;
