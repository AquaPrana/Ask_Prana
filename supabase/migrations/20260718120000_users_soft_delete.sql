-- Soft-delete support for public.users
-- Run this in Supabase SQL Editor (required before Delete Account works).

alter table public.users
  add column if not exists is_deleted boolean not null default false;

alter table public.users
  add column if not exists deleted_at timestamptz null;

-- Allow authenticated users to update their own row (needed for soft delete).
do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'users'
      and policyname = 'Users can update own row'
  ) then
    create policy "Users can update own row"
      on public.users
      for update
      to authenticated
      using (auth.uid() = id)
      with check (auth.uid() = id);
  end if;
end $$;
