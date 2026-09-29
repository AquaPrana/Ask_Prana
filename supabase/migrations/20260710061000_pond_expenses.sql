-- Add labour to global farmer prices
alter table public.farmer_price_configs
  add column if not exists labour_cost_per_day numeric not null default 0;

-- Pond-level expense records (per pond + cycle)
create table if not exists public.pond_expenses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pond_id text not null,
  cycle_id text not null default 'current',
  price_mode text not null default 'fixed' check (price_mode in ('fixed', 'manual')),
  feed_qty_kg numeric not null default 0,
  seed_qty_count numeric not null default 0,
  treatment_qty numeric not null default 0,
  feed_price_per_kg numeric not null default 0,
  seed_price_per_thousand numeric not null default 0,
  treatment_price_per_unit numeric not null default 0,
  labour_cost_per_day numeric not null default 0,
  feed_total numeric not null default 0,
  seed_total numeric not null default 0,
  treatment_total numeric not null default 0,
  labour_total numeric not null default 0,
  others_total numeric not null default 0,
  total numeric not null default 0,
  treatment_products jsonb not null default '[]'::jsonb,
  manual_expenses jsonb not null default '[]'::jsonb,
  configured boolean not null default false,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (pond_id, cycle_id)
);

create index if not exists pond_expenses_user_id_idx on public.pond_expenses (user_id);
create index if not exists pond_expenses_pond_id_idx on public.pond_expenses (pond_id);

alter table public.pond_expenses enable row level security;

create policy "Users can read own pond expenses"
  on public.pond_expenses
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own pond expenses"
  on public.pond_expenses
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own pond expenses"
  on public.pond_expenses
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
