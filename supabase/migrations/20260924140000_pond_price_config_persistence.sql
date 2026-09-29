-- Persist the Price Configuration against its pond as well as the cycle that
-- was active when it was saved. This is intentionally additive: existing
-- cycle price rows are retained and backfilled to their owning pond.

create table if not exists public.price_configs (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null unique references public.crop_cycles (id) on delete cascade,
  pond_id uuid references public.ponds (id) on delete cascade,
  feed_price_per_kg numeric not null default 0,
  seed_price_per_1000 numeric not null default 0,
  seed_price_unit text not null default 'per_piece'
    check (seed_price_unit in ('legacy_per_100000', 'per_piece')),
  labour_cost_per_day numeric not null default 0,
  electricity_rate_per_unit numeric not null default 0,
  fuel_price_per_litre numeric not null default 0,
  treatment_prices jsonb not null default '[]'::jsonb,
  other_expenses jsonb not null default '[]'::jsonb,
  price_source text not null default 'MANUAL'
    check (price_source in ('GLOBAL', 'MANUAL', 'GLOBAL_CUSTOM')),
  global_config_updated_at timestamptz,
  global_price_snapshot jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.price_configs
  add column if not exists pond_id uuid references public.ponds (id) on delete cascade,
  add column if not exists seed_price_unit text not null default 'per_piece',
  add column if not exists labour_cost_per_day numeric not null default 0,
  add column if not exists electricity_rate_per_unit numeric not null default 0,
  add column if not exists fuel_price_per_litre numeric not null default 0,
  add column if not exists treatment_prices jsonb not null default '[]'::jsonb,
  add column if not exists other_expenses jsonb not null default '[]'::jsonb,
  add column if not exists price_source text not null default 'MANUAL',
  add column if not exists global_config_updated_at timestamptz,
  add column if not exists global_price_snapshot jsonb;

-- Rows from the earlier cycle-only implementation remain valid; attach them
-- to their actual pond before new reads switch to pond_id.
update public.price_configs AS config
set pond_id = cycle.pond_id
from public.crop_cycles AS cycle
where config.pond_id is null
  and config.cycle_id = cycle.id;

create index if not exists price_configs_pond_id_updated_at_idx
  on public.price_configs (pond_id, updated_at desc);

alter table public.price_configs enable row level security;

drop policy if exists "Users can read own pond price configs" on public.price_configs;
create policy "Users can read own pond price configs"
  on public.price_configs for select to authenticated
  using (exists (
    select 1 from public.ponds
    where ponds.id = price_configs.pond_id and ponds.user_id = auth.uid()
  ));

drop policy if exists "Users can insert own pond price configs" on public.price_configs;
create policy "Users can insert own pond price configs"
  on public.price_configs for insert to authenticated
  with check (exists (
    select 1 from public.ponds
    where ponds.id = price_configs.pond_id and ponds.user_id = auth.uid()
  ));

drop policy if exists "Users can update own pond price configs" on public.price_configs;
create policy "Users can update own pond price configs"
  on public.price_configs for update to authenticated
  using (exists (
    select 1 from public.ponds
    where ponds.id = price_configs.pond_id and ponds.user_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.ponds
    where ponds.id = price_configs.pond_id and ponds.user_id = auth.uid()
  ));

notify pgrst, 'reload schema';
