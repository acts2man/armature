-- =============================================================================
-- Armature v0.1 — storage bucket for change-request screenshots.
--
-- Apply after 20260921000100_armature_core.sql. Files are stored under
-- <site_id>/<request_id>/<file>, so the site id in the path decides who may read
-- or upload. The bucket is private; the app shows files through signed URLs.
-- =============================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'change-request-attachments',
  'change-request-attachments',
  false,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do nothing;

create policy "attachments: site access read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'change-request-attachments'
    and public.can_access_site(public.try_uuid((storage.foldername(name))[1]))
  );

create policy "attachments: site access upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'change-request-attachments'
    and public.can_access_site(public.try_uuid((storage.foldername(name))[1]))
  );
