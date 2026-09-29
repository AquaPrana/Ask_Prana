-- RPC to add missing farmer_price_configs columns without requiring an edge function.
-- Callable from the app via supabase.rpc('ensure_farmer_price_config_schema').

create or replace function public.ensure_farmer_price_config_schema()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  create table if not exists public.farmer_price_configs (
    user_id uuid primary key references auth.users (id) on delete cascade,
    feed_price_per_kg numeric not null default 0,
    seed_price_per_thousand numeric not null default 0,
    treatment_products jsonb not null default '[]'::jsonb,
    updated_at timestamptz not null default now(),
    created_at timestamptz not null default now()
  );

  alter table public.farmer_price_configs
    add column if not exists labour_cost_per_day numeric not null default 0,
    add column if not exists electricity_rate_per_unit numeric not null default 0,
    add column if not exists fuel_price_per_litre numeric not null default 0,
    add column if not exists other_expenses jsonb not null default '[]'::jsonb;

  alter table public.farmer_price_configs enable row level security;
end;
$$;

revoke all on function public.ensure_farmer_price_config_schema() from public;
grant execute on function public.ensure_farmer_price_config_schema() to authenticated;
grant execute on function public.ensure_farmer_price_config_schema() to service_role;

-- Migrate legacy electricity/diesel standard prices into other_expenses once.
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
               or lower(trim(item->>'name')) = 'electricity bill'
          )
        then jsonb_build_array(
          jsonb_build_object(
            'id',
            gen_random_uuid()::text,
            'name',
            'Electricity',
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
