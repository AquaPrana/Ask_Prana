-- Global farmer price configuration (shared across all ponds for a user)
create table if not exists public.farmer_price_configs (
  user_id uuid primary key references auth.users (id) on delete cascade,
  feed_price_per_kg numeric not null default 0,
  seed_price_per_thousand numeric not null default 0,
  treatment_products jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

alter table public.farmer_price_configs enable row level security;

create policy "Users can read own price config"
  on public.farmer_price_configs
  for select
  using (auth.uid() = user_id);

create policy "Users can insert own price config"
  on public.farmer_price_configs
  for insert
  with check (auth.uid() = user_id);

create policy "Users can update own price config"
  on public.farmer_price_configs
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
