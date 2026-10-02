-- Profile row for each signed-in account. id matches auth.uid().
-- Existing phone with a name logs straight in; a new phone gets an empty
-- profile row and is sent to profile setup.

create table if not exists public.users (
  id uuid primary key references auth.users (id) on delete cascade,
  phone text,
  name text,
  state text,
  district text,
  language text default 'English',
  avatar_url text,
  avatar_updated_at timestamptz,
  is_deleted boolean not null default false,
  deleted_at timestamptz,
  is_active boolean not null default true
);

alter table public.users add column if not exists phone text;
alter table public.users add column if not exists name text;
alter table public.users add column if not exists state text;
alter table public.users add column if not exists district text;
alter table public.users add column if not exists language text default 'English';
alter table public.users add column if not exists avatar_url text;
alter table public.users add column if not exists avatar_updated_at timestamptz;
alter table public.users add column if not exists is_deleted boolean not null default false;
alter table public.users add column if not exists deleted_at timestamptz;
alter table public.users add column if not exists is_active boolean not null default true;

create unique index if not exists users_phone_uidx
  on public.users (phone)
  where phone is not null and btrim(phone) <> '';

alter table public.users enable row level security;

grant select, insert, update on table public.users to authenticated;
grant all on table public.users to service_role;

drop policy if exists "Users can read own row" on public.users;
create policy "Users can read own row"
  on public.users
  for select
  to authenticated
  using (auth.uid() = id);

drop policy if exists "Users can insert own row" on public.users;
create policy "Users can insert own row"
  on public.users
  for insert
  to authenticated
  with check (auth.uid() = id);

drop policy if exists "Users can update own row" on public.users;
create policy "Users can update own row"
  on public.users
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

notify pgrst, 'reload schema';
