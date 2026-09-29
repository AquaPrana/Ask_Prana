-- Baseline snapshot captured when a farmer joins an already-running crop cycle.
-- original_crop_setup and current_pond_condition are stored together but conceptually separate.

alter table public.crop_cycles
  add column if not exists join_snapshot jsonb;

comment on column public.crop_cycles.join_snapshot is
  'Manual join baseline: { originalCropSetup, currentPondCondition }. Does not overwrite historical pond logs.';
