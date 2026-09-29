-- Distinguish pre-stocking water checks from active-cycle farm logs.
-- Pre-stocking rows must not feed FCR, mortality, biomass, or feed totals.

alter table public.pond_logs
  add column if not exists log_phase text;

comment on column public.pond_logs.log_phase is
  'pre_stocking water-quality checks vs active_cycle production logs.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pond_logs_log_phase_check'
  ) then
    alter table public.pond_logs
      add constraint pond_logs_log_phase_check
      check (
        log_phase is null
        or log_phase in ('pre_stocking', 'active_cycle')
      );
  end if;
end
$$;
