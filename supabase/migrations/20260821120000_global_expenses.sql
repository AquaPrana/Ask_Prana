-- Farm-level prices, shared expenses, and immutable crop-cycle price provenance.
-- Existing crop-cycle price rows remain MANUAL for backward compatibility.

alter table public.farmer_price_configs
  add column if not exists electricity_rate_per_unit numeric not null default 0,
  add column if not exists fuel_price_per_litre numeric not null default 0;

alter table if exists public.price_configs
  add column if not exists electricity_rate_per_unit numeric not null default 0,
  add column if not exists fuel_price_per_litre numeric not null default 0,
  add column if not exists price_source text not null default 'MANUAL',
  add column if not exists global_config_updated_at timestamptz,
  add column if not exists global_price_snapshot jsonb;

do $$
begin
  if to_regclass('public.price_configs') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'price_configs_price_source_check'
        and conrelid = 'public.price_configs'::regclass
    ) then
    alter table public.price_configs
      add constraint price_configs_price_source_check
      check (price_source in ('GLOBAL', 'MANUAL', 'GLOBAL_CUSTOM'));
  end if;
end $$;

create table if not exists public.common_farm_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  category text not null default 'Other',
  amount numeric not null check (amount >= 0),
  frequency text not null default 'ONE_TIME'
    check (frequency in ('ONE_TIME', 'DAILY', 'WEEKLY', 'MONTHLY', 'PER_CROP_CYCLE')),
  allocation_type text not null default 'FARM_ONLY'
    check (allocation_type in ('FARM_ONLY', 'ACTIVE_PONDS', 'SELECTED_PONDS')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.common_expense_ponds (
  common_expense_id uuid not null references public.common_farm_expenses (id) on delete cascade,
  pond_id uuid not null references public.ponds (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (common_expense_id, pond_id)
);

create index if not exists common_farm_expenses_user_id_idx
  on public.common_farm_expenses (user_id);
create index if not exists common_expense_ponds_pond_id_idx
  on public.common_expense_ponds (pond_id);

alter table public.common_farm_expenses enable row level security;
alter table public.common_expense_ponds enable row level security;

create policy "Users can read own common farm expenses"
  on public.common_farm_expenses for select
  using (auth.uid() = user_id);
create policy "Users can insert own common farm expenses"
  on public.common_farm_expenses for insert
  with check (auth.uid() = user_id);
create policy "Users can update own common farm expenses"
  on public.common_farm_expenses for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
create policy "Users can delete own common farm expenses"
  on public.common_farm_expenses for delete
  using (auth.uid() = user_id);

create policy "Users can read own common expense ponds"
  on public.common_expense_ponds for select
  using (exists (
    select 1 from public.common_farm_expenses expense
    where expense.id = common_expense_id and expense.user_id = auth.uid()
  ));
create policy "Users can insert own common expense ponds"
  on public.common_expense_ponds for insert
  with check (
    exists (
      select 1 from public.common_farm_expenses expense
      where expense.id = common_expense_id and expense.user_id = auth.uid()
    )
    and exists (
      select 1 from public.ponds pond
      where pond.id = pond_id and pond.user_id = auth.uid()
    )
  );
create policy "Users can delete own common expense ponds"
  on public.common_expense_ponds for delete
  using (exists (
    select 1 from public.common_farm_expenses expense
    where expense.id = common_expense_id and expense.user_id = auth.uid()
  ));

