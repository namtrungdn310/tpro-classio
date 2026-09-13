-- R9.4 — manual receiving-account QR images are private workspace assets.
-- Browsers never access Storage directly; the API validates, normalises and
-- serves the image only to a management user in the owning workspace.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Supabase Storage tables are required for banking QR images';
  end if;
end
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'banking-qr',
  'banking-qr',
  false,
  2097152,
  array['image/webp']::text[]
)
on conflict (id) do update
set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.workspace_payment_accounts
  add column if not exists qr_object_path text;

-- The service-role API is the only Storage writer/reader. Keep direct bucket
-- and object access unavailable to PUBLIC and browser roles even if provider
-- defaults drift later.
revoke all on table storage.buckets from public, anon, authenticated;
revoke all on table storage.objects from public, anon, authenticated;

commit;
