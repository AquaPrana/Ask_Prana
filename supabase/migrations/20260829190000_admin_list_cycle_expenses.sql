-- Admin expense listing. Security-definer so RLS on crop_cycles / pond_expenses
-- cannot hide farmer data from signed-in AquaPrana admins.

create or replace function public.admin_list_cycle_expenses()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cycles jsonb := '[]'::jsonb;
  ponds jsonb := '[]'::jsonb;
  users jsonb := '[]'::jsonb;
  pond_exp jsonb := '[]'::jsonb;
  cycle_exp jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not public.is_aquaprana_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  begin
    select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into cycles from public.crop_cycles c;
  exception
    when undefined_table then cycles := '[]'::jsonb;
  end;

  begin
    select coalesce(
      jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'user_id', p.user_id)),
      '[]'::jsonb
    )
    into ponds
    from public.ponds p;
  exception
    when undefined_table then ponds := '[]'::jsonb;
  end;

  begin
    select coalesce(
      jsonb_agg(jsonb_build_object(
        'id', u.id,
        'name', u.name,
        'district', u.district,
        'state', u.state
      )),
      '[]'::jsonb
    )
    into users
    from public.users u;
  exception
    when undefined_table then users := '[]'::jsonb;
  end;

  begin
    select coalesce(jsonb_agg(to_jsonb(e)), '[]'::jsonb) into pond_exp from public.pond_expenses e;
  exception
    when undefined_table then pond_exp := '[]'::jsonb;
  end;

  begin
    select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) into cycle_exp from public.cycle_expenses x;
  exception
    when undefined_table then cycle_exp := '[]'::jsonb;
  end;

  return jsonb_build_object(
    'cycles', cycles,
    'ponds', ponds,
    'users', users,
    'pond_expenses', pond_exp,
    'cycle_expenses', cycle_exp
  );
end;
$$;

revoke all on function public.admin_list_cycle_expenses() from public;
grant execute on function public.admin_list_cycle_expenses() to authenticated;

-- Do not enable RLS on crop_cycles/ponds here: turning it on without existing
-- write policies would block farmers from creating cycles. Only add SELECT
-- policies so admins can read when RLS is already on.

drop policy if exists "Admins can select all crop cycles" on public.crop_cycles;
create policy "Admins can select all crop cycles"
  on public.crop_cycles
  for select
  to authenticated
  using (public.is_aquaprana_admin());

drop policy if exists "Admins can select all pond expenses" on public.pond_expenses;
create policy "Admins can select all pond expenses"
  on public.pond_expenses
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or public.is_aquaprana_admin()
  );

drop policy if exists "Admins can select all ponds" on public.ponds;
create policy "Admins can select all ponds"
  on public.ponds
  for select
  to authenticated
  using (public.is_aquaprana_admin());

notify pgrst, 'reload schema';
