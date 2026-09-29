-- Tighten profile-photos bucket validation (client also validates).
-- Safe to re-run.

update storage.buckets
set
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = array['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
where id = 'profile-photos';

-- Ensure avatar columns exist (idempotent with earlier migration).
alter table public.users
  add column if not exists avatar_url text;

alter table public.users
  add column if not exists avatar_updated_at timestamptz;
