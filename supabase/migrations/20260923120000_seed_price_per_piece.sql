-- Seed/Fry pricing moves from "per 100,000 count" to "per individual piece".
-- The numeric columns keep their legacy names (seed_price_per_thousand /
-- seed_price_per_1000) so existing rows are never silently reinterpreted.
-- A new seed_price_unit column tags whether a row's value is already in the
-- new per-piece unit ('per_piece') or still holds the old per-100,000 amount
-- ('legacy_per_100000'). The app blanks the Seed/Fry Price field and asks the
-- farmer to re-enter it whenever a row is still tagged legacy.

alter table public.farmer_price_configs
  add column if not exists seed_price_unit text not null default 'legacy_per_100000';

alter table public.farmer_price_configs
  drop constraint if exists farmer_price_configs_seed_price_unit_check;

alter table public.farmer_price_configs
  add constraint farmer_price_configs_seed_price_unit_check
  check (seed_price_unit in ('legacy_per_100000', 'per_piece'));

comment on column public.farmer_price_configs.seed_price_unit is
  'Unit of seed_price_per_thousand: legacy_per_100000 (needs re-entry) or per_piece.';

alter table if exists public.price_configs
  add column if not exists seed_price_unit text not null default 'legacy_per_100000';

do $$
begin
  if to_regclass('public.price_configs') is not null
    and not exists (
      select 1
      from pg_constraint
      where conname = 'price_configs_seed_price_unit_check'
        and conrelid = 'public.price_configs'::regclass
    ) then
    alter table public.price_configs
      add constraint price_configs_seed_price_unit_check
      check (seed_price_unit in ('legacy_per_100000', 'per_piece'));
  end if;
end $$;

comment on column public.price_configs.seed_price_unit is
  'Unit of seed_price_per_1000: legacy_per_100000 (needs re-entry) or per_piece.';

-- upsert_farmer_price_config now always tags saves from the app as per_piece,
-- since the client only ever collects the new per-piece value going forward.
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
    seed_price_unit,
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
    'per_piece',
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
    seed_price_unit = 'per_piece',
    labour_cost_per_day = excluded.labour_cost_per_day,
    electricity_rate_per_unit = 0,
    fuel_price_per_litre = 0,
    treatment_products = excluded.treatment_products,
    other_expenses = excluded.other_expenses,
    updated_at = excluded.updated_at;

  perform pg_notify('pgrst', 'reload schema');
end;
$$;

notify pgrst, 'reload schema';
