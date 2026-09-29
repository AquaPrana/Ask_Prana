-- Profile photo support for authenticated farmers.
-- Stores only a public URL (+ timestamp for cache busting), not image binary.

alter table public.users
  add column if not exists avatar_url text;

alter table public.users
  add column if not exists avatar_updated_at timestamptz;

comment on column public.users.avatar_url is
  'Public Supabase Storage URL for the farmer profile photo (profile-photos bucket).';

comment on column public.users.avatar_updated_at is
  'Last time avatar_url changed; used by clients for cache busting.';

-- Dedicated bucket for profile photos (public read; owner-scoped write).
insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "Users can upload own profile photos" on storage.objects;
create policy "Users can upload own profile photos"
on storage.objects for insert
to authenticated
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can update own profile photos" on storage.objects;
create policy "Users can update own profile photos"
on storage.objects for update
to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Users can read own profile photos" on storage.objects;
create policy "Users can read own profile photos"
on storage.objects for select
to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Public can read profile photos" on storage.objects;
create policy "Public can read profile photos"
on storage.objects for select
to public
using (bucket_id = 'profile-photos');

drop policy if exists "Users can delete own profile photos" on storage.objects;
create policy "Users can delete own profile photos"
on storage.objects for delete
to authenticated
using (
  bucket_id = 'profile-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);
