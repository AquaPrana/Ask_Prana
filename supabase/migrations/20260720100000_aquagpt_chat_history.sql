-- Chat history support on existing aquagpt tables (no new tables).

alter table public.aquagpt_sessions
  add column if not exists title text;

alter table public.aquagpt_sessions
  add column if not exists last_activity timestamptz;

update public.aquagpt_sessions
set last_activity = coalesce(last_activity, created_at, now())
where last_activity is null;

alter table public.aquagpt_sessions
  alter column last_activity set default now();

alter table public.aquagpt_messages
  add column if not exists message_type text default 'text';

alter table public.aquagpt_messages
  add column if not exists file_path text;

alter table public.aquagpt_messages
  add column if not exists file_name text;

alter table public.aquagpt_messages
  add column if not exists mime_type text;

alter table public.aquagpt_messages
  add column if not exists user_id uuid;

alter table public.aquagpt_messages
  add column if not exists pond_id uuid;

-- Ensure users can read/insert/update their own sessions (history + rename).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'aquagpt_sessions'
      and policyname = 'Users can select own aquagpt sessions'
  ) then
    create policy "Users can select own aquagpt sessions"
      on public.aquagpt_sessions for select to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'aquagpt_sessions'
      and policyname = 'Users can insert own aquagpt sessions'
  ) then
    create policy "Users can insert own aquagpt sessions"
      on public.aquagpt_sessions for insert to authenticated
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'aquagpt_sessions'
      and policyname = 'Users can update own aquagpt sessions'
  ) then
    create policy "Users can update own aquagpt sessions"
      on public.aquagpt_sessions for update to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;
