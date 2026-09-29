-- If an earlier restock migration created fulfill_inventory_order with
-- inventory_item_id, replace it so fulfillment uses the live item_id column.

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
