-- =============================================================================
-- Armature v0.1 — a Supabase Storage bucket for site files
--
-- One bucket for every site's uploaded pictures, PDFs and documents. Paths are
-- <agency_id>/<site_id>/<folder>/<file>. The bucket is public (Supabase's CDN
-- will serve any file by URL to anyone with the URL, so pages that embed a file
-- load it straight from the CDN) but nothing is listable: every operation on
-- storage.objects, select included, is gated by RLS on the site id in the path.
-- Only agency staff of the site's agency, or a member of the site itself, may
-- list, upload, replace or delete a file inside their site's folder.
--
-- Long cache headers (Cache-Control: public, max-age=31536000, immutable) are
-- set by the uploader (see supabase/functions/_shared/storage.ts and the browser
-- helper in src/lib/siteStorage.ts) so Supabase's CDN caches the files.
--
-- Nothing about the existing content-repo image path (public/assets/uploads/…)
-- changes: those files stay in the repo. A file uploaded to storage carries a
-- URL under <supabase-url>/storage/v1/object/public/site-files/…, which the
-- Media library treats the same as a repo file.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'site-files',
  'site-files',
  true,
  20971520,
  array[
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif', 'image/svg+xml',
    'application/pdf',
    'text/plain',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Every row in storage.objects for this bucket is gated by can_access_site on
-- the second path segment (the site id). Anonymous callers see nothing at all,
-- so nobody can list one client's files by iterating another client's folder.
-- Public reads of a specific file still work — a public bucket serves files by
-- URL without hitting storage.objects at all.
create policy "site-files: site access read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'site-files'
    and public.can_access_site(public.try_uuid((storage.foldername(name))[2]))
  );

create policy "site-files: site access upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'site-files'
    and public.can_access_site(public.try_uuid((storage.foldername(name))[2]))
  );

create policy "site-files: site access update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'site-files'
    and public.can_access_site(public.try_uuid((storage.foldername(name))[2]))
  )
  with check (
    bucket_id = 'site-files'
    and public.can_access_site(public.try_uuid((storage.foldername(name))[2]))
  );

create policy "site-files: site access delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'site-files'
    and public.can_access_site(public.try_uuid((storage.foldername(name))[2]))
  );

-- A tiny view for the Media library and the Projects list: bytes per site, so we
-- can say "N MB used" without loading every file's metadata. security_invoker
-- means the view is filtered by the caller's own RLS on storage.objects, so the
-- totals only cover sites the caller can access.
create or replace view public.site_storage_totals
  with (security_invoker = true) as
select
  (storage.foldername(name))[2] as site_id,
  count(*)::bigint as file_count,
  coalesce(sum((metadata ->> 'size')::bigint), 0)::bigint as total_bytes
from storage.objects
where bucket_id = 'site-files'
  and (storage.foldername(name))[2] is not null
group by (storage.foldername(name))[2];

revoke all on public.site_storage_totals from anon;
grant select on public.site_storage_totals to authenticated;

comment on view public.site_storage_totals is 'File count and total bytes per site in the site-files bucket. Filtered by the caller''s RLS on storage.objects (security_invoker), so only accessible sites show up.';
