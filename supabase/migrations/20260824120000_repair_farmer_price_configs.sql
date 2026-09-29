-- Ensure all Global Expenses standard price columns exist.
-- Additive and idempotent: existing farmer configurations are preserved.
alter table public.farmer_price_configs
  add column if not exists labour_cost_per_day numeric not null default 0,
  add column if not exists electricity_rate_per_unit numeric not null default 0,
  add column if not exists fuel_price_per_litre numeric not null default 0;

comment on column public.farmer_price_configs.feed_price_per_kg is
  'Standard feed price in currency per kilogram.';
comment on column public.farmer_price_configs.seed_price_per_thousand is
  'Standard seed/fry price in currency per 1000 count.';
comment on column public.farmer_price_configs.labour_cost_per_day is
  'Standard labour cost in currency per day.';
comment on column public.farmer_price_configs.electricity_rate_per_unit is
  'Standard electricity rate in currency per unit.';
comment on column public.farmer_price_configs.fuel_price_per_litre is
  'Standard diesel/fuel price in currency per litre.';

alter table public.farmer_price_configs
  add column if not exists other_expenses jsonb not null default '[]'::jsonb;

comment on column public.farmer_price_configs.other_expenses is
  'Dynamic global other expense items: [{id, name, unit, price}].';

notify pgrst, 'reload schema';
