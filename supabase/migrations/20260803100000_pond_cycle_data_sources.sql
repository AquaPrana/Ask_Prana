-- Persist Daily Log data-source choice per pond + active crop cycle.
create table if not exists public.pond_cycle_data_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pond_id uuid not null references public.ponds (id) on delete cascade,
  cycle_id uuid not null references public.crop_cycles (id) on delete cascade,
  source text not null check (source in ('iot', 'manual', 'bluetooth')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pond_id, cycle_id)
);

create index if not exists pond_cycle_data_sources_user_id_idx
  on public.pond_cycle_data_sources (user_id);

create index if not exists pond_cycle_data_sources_pond_cycle_idx
  on public.pond_cycle_data_sources (pond_id, cycle_id);

alter table public.pond_cycle_data_sources enable row level security;

drop policy if exists "Users manage own pond cycle data sources"
  on public.pond_cycle_data_sources;

create policy "Users manage own pond cycle data sources"
  on public.pond_cycle_data_sources
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
