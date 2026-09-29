-- AquaGPT admin sync: enrichment columns, indexes, realtime, admin RLS.

-- ---------------------------------------------------------------------------
-- Enrich aquagpt_messages for admin monitor (keep existing content column)
-- ---------------------------------------------------------------------------
alter table public.aquagpt_messages
  add column if not exists farmer_name text,
  add column if not exists pond_name text,
  add column if not exists mode text,
  add column if not exists metadata jsonb default '{}'::jsonb,
  add column if not exists attachments jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'aquagpt_messages_mode_check'
  ) then
    alter table public.aquagpt_messages
      add constraint aquagpt_messages_mode_check
      check (mode is null or mode in ('generic', 'pond'));
  end if;
end $$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'aquagpt_messages_role_check'
  ) then
    alter table public.aquagpt_messages
      add constraint aquagpt_messages_role_check
      check (role in ('user', 'assistant'));
  end if;
end $$;

-- Mirror useful fields on sessions for faster admin listing
alter table public.aquagpt_sessions
  add column if not exists farmer_name text,
  add column if not exists pond_name text,
  add column if not exists mode text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'aquagpt_sessions_mode_check'
  ) then
    alter table public.aquagpt_sessions
      add constraint aquagpt_sessions_mode_check
      check (mode is null or mode in ('generic', 'pond'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Indexes (performance)
-- ---------------------------------------------------------------------------
create index if not exists idx_aquagpt_messages_session_id
  on public.aquagpt_messages (session_id);

create index if not exists idx_aquagpt_messages_user_id
  on public.aquagpt_messages (user_id);

create index if not exists idx_aquagpt_messages_created_at
  on public.aquagpt_messages (created_at desc);

create index if not exists idx_aquagpt_messages_pond_id
  on public.aquagpt_messages (pond_id);

create index if not exists idx_aquagpt_messages_mode
  on public.aquagpt_messages (mode);

create index if not exists idx_aquagpt_sessions_user_id
  on public.aquagpt_sessions (user_id);

create index if not exists idx_aquagpt_sessions_last_activity
  on public.aquagpt_sessions (last_activity desc nulls last);

create index if not exists idx_aquagpt_sessions_pond_id
  on public.aquagpt_sessions (pond_id);

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.aquagpt_messages;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.aquagpt_sessions;
exception
  when duplicate_object then null;
end $$;

alter table public.aquagpt_messages replica identity full;
alter table public.aquagpt_sessions replica identity full;

-- ---------------------------------------------------------------------------
-- Admin RLS: authenticated rows in public.admins can read/delete all chats.
-- Mobile users keep owner-only insert/select via existing policies.
-- Service-role (edge /api backend) bypasses RLS entirely.
-- ---------------------------------------------------------------------------
create or replace function public.is_aquaprana_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admins a
    where a.id = auth.uid()
  );
$$;

revoke all on function public.is_aquaprana_admin() from public;
grant execute on function public.is_aquaprana_admin() to authenticated;

drop policy if exists "Admins can select all aquagpt sessions" on public.aquagpt_sessions;
create policy "Admins can select all aquagpt sessions"
  on public.aquagpt_sessions
  for select
  to authenticated
  using (public.is_aquaprana_admin());

drop policy if exists "Admins can delete all aquagpt sessions" on public.aquagpt_sessions;
create policy "Admins can delete all aquagpt sessions"
  on public.aquagpt_sessions
  for delete
  to authenticated
  using (public.is_aquaprana_admin());

drop policy if exists "Admins can select all aquagpt messages" on public.aquagpt_messages;
create policy "Admins can select all aquagpt messages"
  on public.aquagpt_messages
  for select
  to authenticated
  using (public.is_aquaprana_admin());

drop policy if exists "Admins can delete all aquagpt messages" on public.aquagpt_messages;
create policy "Admins can delete all aquagpt messages"
  on public.aquagpt_messages
  for delete
  to authenticated
  using (public.is_aquaprana_admin());
