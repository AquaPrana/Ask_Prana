-- Permanent schema alignment for farmer_price_configs (Global Expenses).
-- Idempotent: safe for existing DBs, fresh setups, dev, and production.

alter table public.farmer_price_configs
  add column if not exists labour_cost_per_day numeric not null default 0,
  add column if not exists electricity_rate_per_unit numeric not null default 0,
  add column if not exists fuel_price_per_litre numeric not null default 0,
  add column if not exists other_expenses jsonb not null default '[]'::jsonb;

comment on column public.farmer_price_configs.feed_price_per_kg is
  'Standard feed price in currency per kilogram.';
comment on column public.farmer_price_configs.seed_price_per_thousand is
  'Standard seed/fry price in currency per 1000 count.';
comment on column public.farmer_price_configs.labour_cost_per_day is
  'Standard labour cost in currency per day.';
comment on column public.farmer_price_configs.electricity_rate_per_unit is
  'Legacy electricity rate (migrated into other_expenses when applicable).';
comment on column public.farmer_price_configs.fuel_price_per_litre is
  'Legacy diesel/fuel price (migrated into other_expenses when applicable).';
comment on column public.farmer_price_configs.treatment_products is
  'Treatment & mineral price items: [{id, name, unit, price}].';
comment on column public.farmer_price_configs.other_expenses is
  'Dynamic global other expense items: [{id, name, unit, price}].';

-- Migrate legacy electricity/fuel standard prices into other_expenses once.
update public.farmer_price_configs AS config
set other_expenses = migrated.expenses
from (
  select
    user_id,
    coalesce(other_expenses, '[]'::jsonb)
      || case
        when electricity_rate_per_unit > 0
          and not exists (
            select 1
            from jsonb_array_elements(coalesce(other_expenses, '[]'::jsonb)) AS item
            where lower(trim(item->>'name')) = 'electricity'
          )
        then jsonb_build_array(
          jsonb_build_object(
            'id',
            gen_random_uuid()::text,
            'name',
            'Electricity',
            'unit',
            'unit',
            'price',
            electricity_rate_per_unit
          )
        )
        else '[]'::jsonb
      end
      || case
        when fuel_price_per_litre > 0
          and not exists (
            select 1
            from jsonb_array_elements(coalesce(other_expenses, '[]'::jsonb)) AS item
            where lower(trim(item->>'name')) in ('diesel/fuel', 'diesel', 'fuel')
          )
        then jsonb_build_array(
          jsonb_build_object(
            'id',
            gen_random_uuid()::text,
            'name',
            'Diesel/Fuel',
            'unit',
            'litre',
            'price',
            fuel_price_per_litre
          )
        )
        else '[]'::jsonb
      end AS expenses
  from public.farmer_price_configs
) AS migrated
where config.user_id = migrated.user_id
  and migrated.expenses is distinct from coalesce(config.other_expenses, '[]'::jsonb);

notify pgrst, 'reload schema';
