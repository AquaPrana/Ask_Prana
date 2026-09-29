-- Save farmer price config via RPC (bypasses PostgREST schema cache for other_expenses).
-- Also refreshes ensure function to notify PostgREST after DDL.

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

  perform pg_notify('pgrst', 'reload schema');
end;
$$;

create or replace function public.upsert_farmer_price_config(
  p_feed_price_per_kg numeric,
  p_seed_price_per_thousand numeric,
  p_labour_cost_per_day numeric,
  p_treatment_products jsonb,
  p_other_expenses jsonb,
  p_updated_at timestamptz default now()
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  perform public.ensure_farmer_price_config_schema();

  insert into public.farmer_price_configs (
    user_id,
    feed_price_per_kg,
    seed_price_per_thousand,
    labour_cost_per_day,
    electricity_rate_per_unit,
    fuel_price_per_litre,
    treatment_products,
    other_expenses,
    updated_at
  ) values (
    v_user_id,
    coalesce(p_feed_price_per_kg, 0),
    coalesce(p_seed_price_per_thousand, 0),
    coalesce(p_labour_cost_per_day, 0),
    0,
    0,
    coalesce(p_treatment_products, '[]'::jsonb),
    coalesce(p_other_expenses, '[]'::jsonb),
    coalesce(p_updated_at, now())
  )
  on conflict (user_id) do update set
    feed_price_per_kg = excluded.feed_price_per_kg,
    seed_price_per_thousand = excluded.seed_price_per_thousand,
    labour_cost_per_day = excluded.labour_cost_per_day,
    electricity_rate_per_unit = 0,
    fuel_price_per_litre = 0,
    treatment_products = excluded.treatment_products,
    other_expenses = excluded.other_expenses,
    updated_at = excluded.updated_at;

  perform pg_notify('pgrst', 'reload schema');
end;
$$;

revoke all on function public.ensure_farmer_price_config_schema() from public;
grant execute on function public.ensure_farmer_price_config_schema() to authenticated;
grant execute on function public.ensure_farmer_price_config_schema() to service_role;

revoke all on function public.upsert_farmer_price_config(numeric, numeric, numeric, jsonb, jsonb, timestamptz) from public;
grant execute on function public.upsert_farmer_price_config(numeric, numeric, numeric, jsonb, jsonb, timestamptz) to authenticated;
grant execute on function public.upsert_farmer_price_config(numeric, numeric, numeric, jsonb, jsonb, timestamptz) to service_role;

notify pgrst, 'reload schema';
