-- Ensure admin can read all AquaGPT rows (fix helper + policies).
-- Also add FK so PostgREST can optionally embed users later.

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
grant execute on function public.is_aquaprana_admin() to anon;

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
  using (
    public.is_aquaprana_admin()
    or exists (
      select 1 from public.aquagpt_sessions s
      where s.id = aquagpt_messages.session_id
        and s.user_id = auth.uid()
    )
  );

drop policy if exists "Admins can delete all aquagpt messages" on public.aquagpt_messages;
create policy "Admins can delete all aquagpt messages"
  on public.aquagpt_messages
  for delete
  to authenticated
  using (
    public.is_aquaprana_admin()
    or exists (
      select 1 from public.aquagpt_sessions s
      where s.id = aquagpt_messages.session_id
        and s.user_id = auth.uid()
    )
  );

-- Optional FK for future embeds (ignore if users.id type mismatch / duplicates).
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'aquagpt_sessions_user_id_fkey'
  ) then
    alter table public.aquagpt_sessions
      add constraint aquagpt_sessions_user_id_fkey
      foreign key (user_id) references public.users(id)
      on delete cascade;
  end if;
exception
  when others then
    raise notice 'Skipping aquagpt_sessions_user_id_fkey: %', SQLERRM;
end $$;

notify pgrst, 'reload schema';
