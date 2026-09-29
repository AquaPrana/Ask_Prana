-- Soft-delete: keep farmer rows and related farm data.
-- Admins can read deleted users and restore them.

alter table public.users
  add column if not exists is_deleted boolean not null default false;

alter table public.users
  add column if not exists deleted_at timestamptz null;

alter table public.users
  add column if not exists is_active boolean not null default true;

create index if not exists users_is_deleted_idx
  on public.users (is_deleted);

drop policy if exists "Admins can select all users" on public.users;
create policy "Admins can select all users"
  on public.users
  for select
  to authenticated
  using (public.is_aquaprana_admin() or auth.uid() = id);

drop policy if exists "Admins can update users" on public.users;
create policy "Admins can update users"
  on public.users
  for update
  to authenticated
  using (public.is_aquaprana_admin() or auth.uid() = id)
  with check (public.is_aquaprana_admin() or auth.uid() = id);

create or replace function public.guard_user_undelete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(old.is_deleted, false) is true
     and coalesce(new.is_deleted, false) is false
     and not public.is_aquaprana_admin() then
    raise exception 'Only an admin can restore a deleted account';
  end if;
  return new;
end;
$$;

drop trigger if exists users_guard_undelete on public.users;
create trigger users_guard_undelete
  before update on public.users
  for each row
  execute function public.guard_user_undelete();

notify pgrst, 'reload schema';
