-- Store up to 5 check tray photo URLs/paths on each daily log.
alter table public.pond_logs
  add column if not exists check_tray_photos jsonb not null default '[]'::jsonb;

comment on column public.pond_logs.check_tray_photos is
  'JSON array of check tray photo objects: [{url, path, fileName}] (max 5).';

-- Storage bucket for pond record images (check tray + other pond photos).
insert into storage.buckets (id, name, public)
values ('pond-records', 'pond-records', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "Users can upload own pond records" on storage.objects;
create policy "Users can upload own pond records"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'pond-records'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update own pond records" on storage.objects;
create policy "Users can update own pond records"
on storage.objects for update
to authenticated
using (
  bucket_id = 'pond-records'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'pond-records'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can read own pond records" on storage.objects;
create policy "Users can read own pond records"
on storage.objects for select
to authenticated
using (
  bucket_id = 'pond-records'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Public can read pond records" on storage.objects;
create policy "Public can read pond records"
on storage.objects for select
to public
using (bucket_id = 'pond-records');

drop policy if exists "Users can delete own pond records" on storage.objects;
create policy "Users can delete own pond records"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'pond-records'
  and (storage.foldername(name))[1] = auth.uid()::text
);
