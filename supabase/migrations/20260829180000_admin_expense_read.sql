-- Admin can read farmer expense data across all cycles.
-- Farmers still write only their own pond_expenses rows.
-- cycle_expenses may already exist in production; this is idempotent.

create extension if not exists "pgcrypto";

create table if not exists public.cycle_expenses (
  id uuid primary key default gen_random_uuid(),
  cycle_id uuid not null unique references public.crop_cycles (id) on delete cascade,
  feed_cost numeric not null default 0,
  seed_cost numeric not null default 0,
  treatment_cost numeric not null default 0,
  labour_cost numeric not null default 0,
  other_cost numeric not null default 0,
  total_cost numeric not null default 0,
  cost_per_kg numeric,
  computed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.cycle_expenses
  add column if not exists feed_cost numeric not null default 0;
alter table public.cycle_expenses
  add column if not exists seed_cost numeric not null default 0;
alter table public.cycle_expenses
  add column if not exists treatment_cost numeric not null default 0;
alter table public.cycle_expenses
  add column if not exists labour_cost numeric not null default 0;
alter table public.cycle_expenses
  add column if not exists other_cost numeric not null default 0;
alter table public.cycle_expenses
  add column if not exists total_cost numeric not null default 0;
alter table public.cycle_expenses
  add column if not exists cost_per_kg numeric;
alter table public.cycle_expenses
  add column if not exists computed_at timestamptz;
alter table public.cycle_expenses
  add column if not exists updated_at timestamptz not null default now();

create index if not exists cycle_expenses_cycle_id_idx
  on public.cycle_expenses (cycle_id);

alter table public.cycle_expenses enable row level security;
alter table public.pond_expenses enable row level security;

-- Farmers can read/write rollups for cycles on ponds they own.
drop policy if exists "Users can read own cycle expenses" on public.cycle_expenses;
create policy "Users can read own cycle expenses"
  on public.cycle_expenses
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.crop_cycles cc
      join public.ponds p on p.id = cc.pond_id
      where cc.id = cycle_expenses.cycle_id
        and p.user_id = auth.uid()
    )
    or public.is_aquaprana_admin()
  );

drop policy if exists "Users can write own cycle expenses" on public.cycle_expenses;
create policy "Users can write own cycle expenses"
  on public.cycle_expenses
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.crop_cycles cc
      join public.ponds p on p.id = cc.pond_id
      where cc.id = cycle_expenses.cycle_id
        and p.user_id = auth.uid()
    )
    or public.is_aquaprana_admin()
  );

drop policy if exists "Users can update own cycle expenses" on public.cycle_expenses;
create policy "Users can update own cycle expenses"
  on public.cycle_expenses
  for update
  to authenticated
  using (
    exists (
      select 1
      from public.crop_cycles cc
      join public.ponds p on p.id = cc.pond_id
      where cc.id = cycle_expenses.cycle_id
        and p.user_id = auth.uid()
    )
    or public.is_aquaprana_admin()
  )
  with check (
    exists (
      select 1
      from public.crop_cycles cc
      join public.ponds p on p.id = cc.pond_id
      where cc.id = cycle_expenses.cycle_id
        and p.user_id = auth.uid()
    )
    or public.is_aquaprana_admin()
  );

drop policy if exists "Admins can select all pond expenses" on public.pond_expenses;
create policy "Admins can select all pond expenses"
  on public.pond_expenses
  for select
  to authenticated
  using (
    auth.uid() = user_id
    or public.is_aquaprana_admin()
  );

grant select, insert, update on public.cycle_expenses to authenticated;
grant select on public.pond_expenses to authenticated;

do $$
begin
  if to_regclass('public.crop_cycles') is null then
    return;
  end if;
  execute 'drop policy if exists "Admins can select all crop cycles" on public.crop_cycles';
  execute 'create policy "Admins can select all crop cycles" on public.crop_cycles for select to authenticated using (public.is_aquaprana_admin())';
exception
  when others then
    raise notice 'Skipping crop_cycles admin policy: %', SQLERRM;
end $$;

notify pgrst, 'reload schema';
