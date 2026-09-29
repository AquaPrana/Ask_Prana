-- Persist farmer feed-result for Day 15+ daily logs (Finished / Leftover).
-- Non-destructive: existing rows keep NULL; no renames/drops.

alter table public.pond_logs
  add column if not exists feed_consumption_status text;

comment on column public.pond_logs.feed_consumption_status is
  'Farmer feed result for next-day recommendation: finished | leftover (null for older/pre-Day-15 logs).';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'pond_logs_feed_consumption_status_check'
  ) then
    alter table public.pond_logs
      add constraint pond_logs_feed_consumption_status_check
      check (
        feed_consumption_status is null
        or feed_consumption_status in ('finished', 'leftover')
      );
  end if;
end $$;
