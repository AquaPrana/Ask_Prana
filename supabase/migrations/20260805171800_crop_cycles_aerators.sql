-- Aerator Intelligence Module fields for crop cycles.

alter table public.crop_cycles
  add column if not exists aerator_count integer,
  add column if not exists hp_per_aerator numeric,
  add column if not exists total_installed_hp numeric;

comment on column public.crop_cycles.aerator_count is 'Number of aerators installed for this cycle (1-8).';
comment on column public.crop_cycles.hp_per_aerator is 'Horsepower per aerator.';
comment on column public.crop_cycles.total_installed_hp is 'Auto: aerator_count * hp_per_aerator.';
