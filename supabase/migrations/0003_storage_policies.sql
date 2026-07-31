insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'private-talk-files',
  'private-talk-files',
  false,
  52428800,
  array[
    'image/jpeg','image/png','image/webp','image/gif','application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip','audio/mpeg','audio/mp4','video/mp4'
  ]
) on conflict (id) do nothing;

create policy storage_room_member_read on storage.objects for select to authenticated
using (
  bucket_id = 'private-talk-files'
  and exists (
    select 1 from public.uploaded_files f
    where f.storage_key = name
      and f.deleted_at is null
      and (f.uploader_id = auth.uid() or public.is_room_member(f.room_id) or public.is_admin())
  )
);

create policy storage_upload_own_prefix on storage.objects for insert to authenticated
with check (
  bucket_id = 'private-talk-files'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy storage_delete_owner_or_admin on storage.objects for delete to authenticated
using (
  bucket_id = 'private-talk-files'
  and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin())
);
