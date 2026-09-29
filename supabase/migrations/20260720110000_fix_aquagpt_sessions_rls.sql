-- Fix AquaGPT chat history RLS so authenticated users can create/list/update sessions.

alter table public.aquagpt_sessions enable row level security;
alter table public.aquagpt_messages enable row level security;

drop policy if exists "Users can select own aquagpt sessions" on public.aquagpt_sessions;
drop policy if exists "Users can insert own aquagpt sessions" on public.aquagpt_sessions;
drop policy if exists "Users can update own aquagpt sessions" on public.aquagpt_sessions;
drop policy if exists "Users can delete own aquagpt sessions" on public.aquagpt_sessions;
drop policy if exists "Users can manage own aquagpt sessions" on public.aquagpt_sessions;

create policy "Users can select own aquagpt sessions"
  on public.aquagpt_sessions
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "Users can insert own aquagpt sessions"
  on public.aquagpt_sessions
  for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "Users can update own aquagpt sessions"
  on public.aquagpt_sessions
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own aquagpt sessions"
  on public.aquagpt_sessions
  for delete
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can manage own AI messages" on public.aquagpt_messages;
drop policy if exists "Users can delete own aquagpt messages" on public.aquagpt_messages;
drop policy if exists "Users can select own aquagpt messages" on public.aquagpt_messages;
drop policy if exists "Users can insert own aquagpt messages" on public.aquagpt_messages;
drop policy if exists "Users can update own aquagpt messages" on public.aquagpt_messages;

create policy "Users can select own aquagpt messages"
  on public.aquagpt_messages
  for select
  to authenticated
  using (
    exists (
      select 1 from public.aquagpt_sessions s
      where s.id = aquagpt_messages.session_id
        and s.user_id = auth.uid()
    )
  );

create policy "Users can insert own aquagpt messages"
  on public.aquagpt_messages
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.aquagpt_sessions s
      where s.id = aquagpt_messages.session_id
        and s.user_id = auth.uid()
    )
  );

create policy "Users can update own aquagpt messages"
  on public.aquagpt_messages
  for update
  to authenticated
  using (
    exists (
      select 1 from public.aquagpt_sessions s
      where s.id = aquagpt_messages.session_id
        and s.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.aquagpt_sessions s
      where s.id = aquagpt_messages.session_id
        and s.user_id = auth.uid()
    )
  );

create policy "Users can delete own aquagpt messages"
  on public.aquagpt_messages
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.aquagpt_sessions s
      where s.id = aquagpt_messages.session_id
        and s.user_id = auth.uid()
    )
  );
