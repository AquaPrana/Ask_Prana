-- Admin restore for soft-deleted farmer accounts.
-- Security definer bypasses RLS so restore works reliably from the admin dashboard.

alter table public.users
  add column if not exists is_deleted boolean not null default false;

alter table public.users
  add column if not exists deleted_at timestamptz null;

alter table public.users
  add column if not exists is_active boolean not null default true;

create or replace function public.admin_restore_farmer_account(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.users%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated' using errcode = '42501';
  end if;

  if not public.is_aquaprana_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'user_id is required' using errcode = '22023';
  end if;

  update public.users
  set
    is_deleted = false,
    deleted_at = null,
    is_active = true
  where id = p_user_id
  returning * into v_row;

  if not found then
    raise exception 'User not found' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'is_deleted', v_row.is_deleted,
    'deleted_at', v_row.deleted_at,
    'is_active', v_row.is_active
  );
end;
$$;

revoke all on function public.admin_restore_farmer_account(uuid) from public;
grant execute on function public.admin_restore_farmer_account(uuid) to authenticated;
grant execute on function public.admin_restore_farmer_account(uuid) to service_role;

notify pgrst, 'reload schema';
