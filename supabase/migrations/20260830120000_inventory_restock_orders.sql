-- Restock creates a pending inventory_orders row using the live columns:
-- id, item_id, user_id, quantity, status, requested_at, fulfilled_at
-- current_qty increases only when an order is fulfilled, in one transaction.

create table if not exists public.inventory_orders (
  id uuid primary key default gen_random_uuid(),
  item_id uuid references public.inventory_items (id) on delete set null,
  user_id uuid not null references auth.users (id) on delete cascade,
  quantity numeric not null,
  status text not null default 'pending',
  requested_at timestamptz not null default now(),
  fulfilled_at timestamptz
);

alter table public.inventory_orders
  add column if not exists item_id uuid,
  add column if not exists user_id uuid,
  add column if not exists quantity numeric,
  add column if not exists status text,
  add column if not exists requested_at timestamptz,
  add column if not exists fulfilled_at timestamptz;

update public.inventory_orders
set
  status = coalesce(nullif(trim(status), ''), 'pending'),
  requested_at = coalesce(requested_at, now());

create index if not exists inventory_orders_user_requested_idx
  on public.inventory_orders (user_id, requested_at desc);

create index if not exists inventory_orders_item_status_idx
  on public.inventory_orders (item_id, status);

alter table public.inventory_orders enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'inventory_orders'
      and policyname = 'Users can select own inventory orders'
  ) then
    create policy "Users can select own inventory orders"
      on public.inventory_orders for select to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'inventory_orders'
      and policyname = 'Users can insert own inventory orders'
  ) then
    create policy "Users can insert own inventory orders"
      on public.inventory_orders for insert to authenticated
      with check (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'inventory_orders'
      and policyname = 'Users can update own inventory orders'
  ) then
    create policy "Users can update own inventory orders"
      on public.inventory_orders for update to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

grant select, insert, update on public.inventory_orders to authenticated;

create or replace function public.fulfill_inventory_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_order public.inventory_orders%rowtype;
  v_item_id uuid;
  v_quantity numeric;
  v_new_qty numeric;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  if p_order_id is null then
    raise exception 'Order id is required';
  end if;

  select * into v_order
  from public.inventory_orders
  where id = p_order_id
    and user_id = v_user_id
  for update;

  if not found then
    raise exception 'Order not found';
  end if;

  if lower(coalesce(v_order.status, '')) <> 'pending' then
    raise exception 'Order is not pending';
  end if;

  v_item_id := v_order.item_id;
  v_quantity := v_order.quantity;

  if v_item_id is null then
    raise exception 'Order is missing inventory item';
  end if;

  if v_quantity is null or v_quantity <= 0 then
    raise exception 'Order quantity must be greater than 0';
  end if;

  update public.inventory_items
  set current_qty = coalesce(current_qty, 0) + v_quantity
  where id = v_item_id
    and user_id = v_user_id
  returning current_qty into v_new_qty;

  if not found then
    raise exception 'Inventory item not found';
  end if;

  update public.inventory_orders
  set
    status = 'fulfilled',
    fulfilled_at = now()
  where id = p_order_id
    and user_id = v_user_id
    and lower(coalesce(status, '')) = 'pending';

  if not found then
    raise exception 'Order is not pending';
  end if;

  return jsonb_build_object(
    'order_id', p_order_id,
    'status', 'fulfilled',
    'current_qty', v_new_qty
  );
end;
$$;

revoke all on function public.fulfill_inventory_order(uuid) from public;
grant execute on function public.fulfill_inventory_order(uuid) to authenticated;
