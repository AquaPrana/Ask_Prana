-- Partial Harvest Management Module (AquaPrana)
-- Production-safe / additive migration for public.harvest_transactions.
--
-- Guarantees:
-- - Does NOT drop, truncate, or recreate existing production tables.
-- - Does NOT drop schemas or wipe data.
-- - Does NOT use DROP FUNCTION (uses CREATE OR REPLACE instead).
-- - Does NOT DROP TRIGGER (creates trigger only if missing).
-- - Creates the harvest table only if it does not already exist.
-- - Adds columns / indexes / constraints only when missing.
-- - RLS policy is created only if this module's named policy is missing
--   (no DROP POLICY), so existing access rules are not removed on rerun.
-- - CREATE OR REPLACE updates only this module's RPC + updated_at helper.

-- ---------------------------------------------------------------------------
-- 1) Table (create only if missing)
-- ---------------------------------------------------------------------------
create table if not exists public.harvest_transactions (
  id uuid primary key default gen_random_uuid(),
  pond_id uuid not null references public.ponds (id) on delete cascade,
  crop_cycle_id uuid not null references public.crop_cycles (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  harvest_no integer not null,
  harvest_date date not null,
  harvest_type text not null,
  harvest_stage text null,
  harvest_quantity_kg numeric not null,
  harvest_size_count_per_kg numeric not null,
  abw_g numeric not null,
  selling_price_per_kg numeric not null,
  buyer text null,
  remarks text null,
  invoice_url text null,
  previous_shrimp_count numeric not null,
  harvested_shrimp_count numeric not null,
  remaining_shrimp_count numeric not null,
  previous_biomass_kg numeric not null,
  remaining_biomass_kg numeric not null,
  revenue numeric not null,
  cumulative_harvested_kg numeric not null,
  estimated_total_production_kg numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 2) Additive column upgrades (safe if table already existed with older shape)
-- ---------------------------------------------------------------------------
alter table public.harvest_transactions
  add column if not exists harvest_stage text null;

alter table public.harvest_transactions
  add column if not exists estimated_total_production_kg numeric;

-- Narrow backfill only for NULL estimated production (does not overwrite values).
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'harvest_transactions'
      and column_name = 'total_production_kg'
  ) then
    execute $sql$
      update public.harvest_transactions
      set estimated_total_production_kg = total_production_kg
      where estimated_total_production_kg is null
        and total_production_kg is not null
    $sql$;
  end if;
end $$;

update public.harvest_transactions
set estimated_total_production_kg = coalesce(
  cumulative_harvested_kg, 0
) + coalesce(remaining_biomass_kg, 0)
where estimated_total_production_kg is null;

alter table public.harvest_transactions
  alter column estimated_total_production_kg set default 0;

-- Set NOT NULL only when every row already has a value (no data loss / no wipe).
do $$
begin
  if not exists (
    select 1
    from public.harvest_transactions
    where estimated_total_production_kg is null
  ) then
    alter table public.harvest_transactions
      alter column estimated_total_production_kg set not null;
  else
    raise notice
      'Leaving estimated_total_production_kg nullable: null rows remain after backfill.';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 3) Constraints (add only if missing — no drop/recreate of unrelated constraints)
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'harvest_transactions_harvest_type_check'
  ) then
    alter table public.harvest_transactions
      add constraint harvest_transactions_harvest_type_check
      check (harvest_type in ('partial', 'final'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'harvest_transactions_harvest_stage_check'
  ) then
    alter table public.harvest_transactions
      add constraint harvest_transactions_harvest_stage_check
      check (
        harvest_stage is null
        or harvest_stage in (
          'mid_crop',
          'pre_final',
          'final',
          'emergency',
          'thinning',
          'other'
        )
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'harvest_transactions_harvest_quantity_kg_check'
  ) then
    alter table public.harvest_transactions
      add constraint harvest_transactions_harvest_quantity_kg_check
      check (harvest_quantity_kg > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'harvest_transactions_harvest_size_count_per_kg_check'
  ) then
    alter table public.harvest_transactions
      add constraint harvest_transactions_harvest_size_count_per_kg_check
      check (harvest_size_count_per_kg > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'harvest_transactions_abw_g_check'
  ) then
    alter table public.harvest_transactions
      add constraint harvest_transactions_abw_g_check
      check (abw_g > 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'harvest_transactions_selling_price_per_kg_check'
  ) then
    alter table public.harvest_transactions
      add constraint harvest_transactions_selling_price_per_kg_check
      check (selling_price_per_kg >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'harvest_transactions_remaining_shrimp_count_check'
  ) then
    alter table public.harvest_transactions
      add constraint harvest_transactions_remaining_shrimp_count_check
      check (remaining_shrimp_count >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'harvest_transactions_remaining_biomass_kg_check'
  ) then
    alter table public.harvest_transactions
      add constraint harvest_transactions_remaining_biomass_kg_check
      check (remaining_biomass_kg >= 0);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'harvest_transactions_crop_cycle_id_harvest_no_key'
  ) then
    alter table public.harvest_transactions
      add constraint harvest_transactions_crop_cycle_id_harvest_no_key
      unique (crop_cycle_id, harvest_no);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4) Indexes (idempotent)
-- ---------------------------------------------------------------------------
create index if not exists harvest_transactions_pond_id_idx
  on public.harvest_transactions (pond_id);
create index if not exists harvest_transactions_crop_cycle_id_idx
  on public.harvest_transactions (crop_cycle_id);
create index if not exists harvest_transactions_user_id_idx
  on public.harvest_transactions (user_id);
create index if not exists harvest_transactions_harvest_date_idx
  on public.harvest_transactions (harvest_date);
create index if not exists harvest_transactions_cycle_no_idx
  on public.harvest_transactions (crop_cycle_id, harvest_no);

-- ---------------------------------------------------------------------------
-- 5) updated_at helper + trigger (no DROP TRIGGER)
-- ---------------------------------------------------------------------------
create or replace function public.set_harvest_transactions_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_trigger
    where tgname = 'harvest_transactions_set_updated_at'
      and tgrelid = 'public.harvest_transactions'::regclass
  ) then
    create trigger harvest_transactions_set_updated_at
    before update on public.harvest_transactions
    for each row
    execute function public.set_harvest_transactions_updated_at();
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 6) RLS + narrowly scoped policy (no DROP POLICY)
--    Policy is created only when this exact policy name is absent.
--    Safe on rerun: does not remove other policies or broaden access.
-- ---------------------------------------------------------------------------
alter table public.harvest_transactions enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'harvest_transactions'
      and policyname = 'Users manage own harvest transactions'
  ) then
    create policy "Users manage own harvest transactions"
      on public.harvest_transactions
      for all
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

comment on table public.harvest_transactions is
  'Immutable audit log of partial/final harvests. Never overwrite prior rows.';

-- ---------------------------------------------------------------------------
-- 7) Atomic RPC (CREATE OR REPLACE only — no DROP FUNCTION)
-- ---------------------------------------------------------------------------
create or replace function public.record_harvest_transaction(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_pond_id uuid;
  v_cycle_id uuid;
  v_harvest_date date;
  v_harvest_type text;
  v_harvest_stage text;
  v_quantity numeric;
  v_count_per_kg numeric;
  v_abw numeric;
  v_price numeric;
  v_buyer text;
  v_remarks text;
  v_invoice text;
  v_close_cycle boolean;
  v_cycle public.crop_cycles%rowtype;
  v_next_no integer;
  v_prev_shrimp numeric;
  v_prev_biomass numeric;
  v_harvested_shrimp numeric;
  v_remaining_shrimp numeric;
  v_remaining_biomass numeric;
  v_revenue numeric;
  v_prior_harvested numeric;
  v_cumulative numeric;
  v_total_production numeric;
  v_stocked numeric;
  v_survival numeric;
  v_row public.harvest_transactions%rowtype;
begin
  if v_user_id is null then
    raise exception 'Not authenticated';
  end if;

  v_pond_id := (payload->>'pond_id')::uuid;
  v_cycle_id := (payload->>'crop_cycle_id')::uuid;
  v_harvest_date := (payload->>'harvest_date')::date;
  v_harvest_type := lower(payload->>'harvest_type');
  v_harvest_stage := nullif(lower(payload->>'harvest_stage'), '');
  v_quantity := (payload->>'harvest_quantity_kg')::numeric;
  v_count_per_kg := (payload->>'harvest_size_count_per_kg')::numeric;
  v_abw := (payload->>'abw_g')::numeric;
  v_price := (payload->>'selling_price_per_kg')::numeric;
  v_buyer := nullif(trim(payload->>'buyer'), '');
  v_remarks := nullif(trim(payload->>'remarks'), '');
  v_invoice := nullif(trim(payload->>'invoice_url'), '');
  v_close_cycle := coalesce((payload->>'close_cycle')::boolean, false);

  if v_pond_id is null or v_cycle_id is null then
    raise exception 'pond_id and crop_cycle_id are required';
  end if;
  if v_harvest_type not in ('partial', 'final') then
    raise exception 'harvest_type must be partial or final';
  end if;

  if v_harvest_type = 'final' then
    v_harvest_stage := 'final';
  elsif v_harvest_stage is null
     or v_harvest_stage not in ('mid_crop', 'pre_final', 'emergency', 'thinning', 'other') then
    raise exception 'harvest_stage is required for partial harvest';
  end if;

  if v_quantity is null or v_quantity <= 0 then
    raise exception 'harvest_quantity_kg must be > 0';
  end if;
  if v_count_per_kg is null or v_count_per_kg <= 0 then
    raise exception 'harvest_size_count_per_kg must be > 0';
  end if;
  if v_abw is null or v_abw <= 0 then
    raise exception 'abw_g must be > 0';
  end if;
  if v_price is null or v_price < 0 then
    raise exception 'selling_price_per_kg must be >= 0';
  end if;

  if not exists (select 1 from public.ponds p where p.id = v_pond_id) then
    raise exception 'Pond not found';
  end if;

  if exists (
    select 1
    from public.ponds p
    where p.id = v_pond_id
      and p.user_id is not null
      and p.user_id <> v_user_id
  ) then
    raise exception 'Not authorized for this pond';
  end if;

  select *
  into v_cycle
  from public.crop_cycles
  where id = v_cycle_id
    and pond_id = v_pond_id
  for update;

  if not found then
    raise exception 'Crop cycle not found';
  end if;

  if v_cycle.status is distinct from 'active' and v_harvest_type = 'partial' then
    raise exception 'Crop cycle is not active';
  end if;

  select coalesce(max(harvest_no), 0) + 1
  into v_next_no
  from public.harvest_transactions
  where crop_cycle_id = v_cycle_id;

  select coalesce(sum(harvest_quantity_kg), 0)
  into v_prior_harvested
  from public.harvest_transactions
  where crop_cycle_id = v_cycle_id;

  if v_cycle.current_biomass_kg is not null
     and v_cycle.current_biomass_kg > 0
     and v_cycle.current_abw_g is not null
     and v_cycle.current_abw_g > 0 then
    v_prev_biomass := v_cycle.current_biomass_kg;
    v_prev_shrimp := round((v_prev_biomass * 1000) / v_cycle.current_abw_g);
  else
    v_stocked := coalesce(v_cycle.stocking_density, 0);
    v_survival := coalesce(v_cycle.survival_rate, 100);
    v_prev_shrimp := greatest(
      round((v_stocked * v_survival) / 100.0)
        - coalesce((
            select sum(harvested_shrimp_count)
            from public.harvest_transactions
            where crop_cycle_id = v_cycle_id
          ), 0),
      0
    );
    v_prev_biomass := round((v_prev_shrimp * v_abw) / 1000.0, 2);
  end if;

  v_harvested_shrimp := round((v_quantity * 1000) / v_abw);
  if v_harvested_shrimp > v_prev_shrimp then
    raise exception 'Harvest exceeds available shrimp (%)', v_prev_shrimp;
  end if;
  if v_quantity > v_prev_biomass + 0.01 then
    raise exception 'Harvest exceeds available biomass (%) kg', v_prev_biomass;
  end if;

  if v_harvest_type = 'final' and v_close_cycle then
    v_remaining_shrimp := 0;
    v_remaining_biomass := 0;
  else
    v_remaining_shrimp := greatest(v_prev_shrimp - v_harvested_shrimp, 0);
    v_remaining_biomass := round((v_remaining_shrimp * v_abw) / 1000.0, 2);
  end if;

  v_revenue := round(v_quantity * v_price, 2);
  v_cumulative := round(v_prior_harvested + v_quantity, 2);
  v_total_production := round(v_cumulative + v_remaining_biomass, 2);

  insert into public.harvest_transactions (
    pond_id,
    crop_cycle_id,
    user_id,
    harvest_no,
    harvest_date,
    harvest_type,
    harvest_stage,
    harvest_quantity_kg,
    harvest_size_count_per_kg,
    abw_g,
    selling_price_per_kg,
    buyer,
    remarks,
    invoice_url,
    previous_shrimp_count,
    harvested_shrimp_count,
    remaining_shrimp_count,
    previous_biomass_kg,
    remaining_biomass_kg,
    revenue,
    cumulative_harvested_kg,
    estimated_total_production_kg
  ) values (
    v_pond_id,
    v_cycle_id,
    v_user_id,
    v_next_no,
    coalesce(v_harvest_date, current_date),
    v_harvest_type,
    v_harvest_stage,
    v_quantity,
    v_count_per_kg,
    v_abw,
    v_price,
    v_buyer,
    v_remarks,
    v_invoice,
    v_prev_shrimp,
    v_harvested_shrimp,
    v_remaining_shrimp,
    v_prev_biomass,
    v_remaining_biomass,
    v_revenue,
    v_cumulative,
    v_total_production
  )
  returning * into v_row;

  -- Runtime harvest path only: updates existing crop_cycles columns already in use.
  -- Does not add/drop crop_cycles columns in this migration.
  update public.crop_cycles
  set
    current_biomass_kg = v_remaining_biomass,
    current_abw_g = v_abw,
    current_feed_per_day_kg = null,
    status = case
      when v_harvest_type = 'final' and v_close_cycle then 'closed'
      else status
    end,
    closed_at = case
      when v_harvest_type = 'final' and v_close_cycle then now()
      else closed_at
    end,
    harvest_weight_kg = case
      when v_harvest_type = 'final' and v_close_cycle then v_cumulative
      else harvest_weight_kg
    end,
    actual_harvest_date = case
      when v_harvest_type = 'final' and v_close_cycle then coalesce(v_harvest_date, current_date)
      else actual_harvest_date
    end
  where id = v_cycle_id;

  return jsonb_build_object(
    'transaction', to_jsonb(v_row),
    'summary', jsonb_build_object(
      'remaining_shrimp_count', v_remaining_shrimp,
      'remaining_biomass_kg', v_remaining_biomass,
      'cumulative_harvested_kg', v_cumulative,
      'total_revenue', (
        select coalesce(sum(revenue), 0)
        from public.harvest_transactions
        where crop_cycle_id = v_cycle_id
      ),
      'estimated_total_production_kg', v_total_production,
      'partial_harvest_count', (
        select count(*)::int
        from public.harvest_transactions
        where crop_cycle_id = v_cycle_id
          and harvest_type = 'partial'
      ),
      'last_harvest_date', v_row.harvest_date,
      'cycle_closed', (v_harvest_type = 'final' and v_close_cycle)
    )
  );
end;
$$;

-- Harden RPC privileges (does not delete data).
revoke all on function public.record_harvest_transaction(jsonb) from public;
grant execute on function public.record_harvest_transaction(jsonb) to authenticated;

notify pgrst, 'reload schema';
