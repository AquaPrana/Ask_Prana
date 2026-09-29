-- Allow authenticated users to delete their own related rows for permanent account deletion.
-- Ponds + users already have delete policies; these cover remaining tables.

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_items'
      and policyname = 'Users can delete own inventory items'
  ) then
    create policy "Users can delete own inventory items"
      on public.inventory_items for delete to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'inventory_orders'
      and policyname = 'Users can delete own inventory orders'
  ) then
    create policy "Users can delete own inventory orders"
      on public.inventory_orders for delete to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'aquagpt_sessions'
      and policyname = 'Users can delete own aquagpt sessions'
  ) then
    create policy "Users can delete own aquagpt sessions"
      on public.aquagpt_sessions for delete to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'aquagpt_usage'
      and policyname = 'Users can delete own aquagpt usage'
  ) then
    create policy "Users can delete own aquagpt usage"
      on public.aquagpt_usage for delete to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'pond_expenses'
      and policyname = 'Users can delete own pond expenses'
  ) then
    create policy "Users can delete own pond expenses"
      on public.pond_expenses for delete to authenticated
      using (auth.uid() = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'farmer_price_configs'
      and policyname = 'Users can delete own price configs'
  ) then
    create policy "Users can delete own price configs"
      on public.farmer_price_configs for delete to authenticated
      using (auth.uid() = user_id);
  end if;
end $$;

-- Messages: allow delete when session belongs to the user
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'aquagpt_messages'
  ) and not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'aquagpt_messages'
      and policyname = 'Users can delete own aquagpt messages'
  ) then
    create policy "Users can delete own aquagpt messages"
      on public.aquagpt_messages for delete to authenticated
      using (
        exists (
          select 1 from public.aquagpt_sessions s
          where s.id = aquagpt_messages.session_id
            and s.user_id = auth.uid()
        )
      );
  end if;
end $$;
