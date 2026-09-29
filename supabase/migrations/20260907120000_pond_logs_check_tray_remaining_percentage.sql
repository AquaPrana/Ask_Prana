-- Farmer-entered check-tray uneaten-feed remaining percent (0–100).
-- Additive / production-safe. Existing pond_logs rows stay NULL.

alter table public.pond_logs
  add column if not exists check_tray_remaining_percentage numeric;

comment on column public.pond_logs.check_tray_remaining_percentage is
  'Farmer-entered check-tray feed remaining percent (0-100). Null on historical logs from before this field existed.';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pond_logs_check_tray_remaining_percentage_check'
  ) then
    alter table public.pond_logs
      add constraint pond_logs_check_tray_remaining_percentage_check
      check (
        check_tray_remaining_percentage is null
        or (
          check_tray_remaining_percentage >= 0
          and check_tray_remaining_percentage <= 100
        )
      );
  end if;
end $$;
