-- Store the farmer's check-tray observation as feed quantities, not as photo metadata.
-- "leftover" is the uneaten feed seen in the tray/net; "consumed" is 100 - leftover.
-- Existing check_tray_remaining_percentage is retained for backwards compatibility.

alter table public.pond_logs
  add column if not exists check_tray_feed_remaining_percentage numeric,
  add column if not exists check_tray_feed_consumed_percentage numeric;

comment on column public.pond_logs.check_tray_feed_remaining_percentage is
  'Farmer-observed uneaten feed remaining in the check tray/net, as a percentage (0-100).';

comment on column public.pond_logs.check_tray_feed_consumed_percentage is
  'Calculated feed consumed from the check tray/net, as a percentage (0-100): 100 minus leftover.';

-- Populate the explicit fields for existing records that already used the original
-- remaining-percentage column. Photo JSON is deliberately not used for new data.
update public.pond_logs
set
  check_tray_feed_remaining_percentage = check_tray_remaining_percentage,
  check_tray_feed_consumed_percentage = 100 - check_tray_remaining_percentage
where check_tray_remaining_percentage is not null
  and check_tray_feed_remaining_percentage is null
  and check_tray_feed_consumed_percentage is null;

-- Older app versions added recommendation metadata to check_tray_photos. Keep
-- only objects with an actual URL so the column again means photos only.
update public.pond_logs as log
set check_tray_photos = coalesce(
  (
    select jsonb_agg(photo)
    from jsonb_array_elements(log.check_tray_photos) as photo
    where coalesce(photo ->> 'url', '') <> ''
  ),
  '[]'::jsonb
)
where jsonb_typeof(log.check_tray_photos) = 'array'
  and exists (
    select 1
    from jsonb_array_elements(log.check_tray_photos) as photo
    where coalesce(photo ->> 'url', '') = ''
      and (
        photo ? 'checkTrayRemainingPercentage'
        or photo ? 'recommendedFeedQuantity'
        or photo ? 'feedRecommendationReason'
      )
  );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pond_logs_check_tray_feed_remaining_percentage_check'
  ) then
    alter table public.pond_logs
      add constraint pond_logs_check_tray_feed_remaining_percentage_check
      check (check_tray_feed_remaining_percentage is null or check_tray_feed_remaining_percentage between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'pond_logs_check_tray_feed_consumed_percentage_check'
  ) then
    alter table public.pond_logs
      add constraint pond_logs_check_tray_feed_consumed_percentage_check
      check (check_tray_feed_consumed_percentage is null or check_tray_feed_consumed_percentage between 0 and 100);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'pond_logs_check_tray_feed_balance_check'
  ) then
    alter table public.pond_logs
      add constraint pond_logs_check_tray_feed_balance_check
      check (
        check_tray_feed_remaining_percentage is null
        or check_tray_feed_consumed_percentage is null
        or check_tray_feed_remaining_percentage + check_tray_feed_consumed_percentage = 100
      );
  end if;
end $$;

-- Retain real historical images without presenting them as the feed observation.
alter table public.pond_logs
  rename column check_tray_photos to check_tray_image_refs;

comment on column public.pond_logs.check_tray_image_refs is
  'Optional historical check-tray image objects: [{url, path, fileName}].';

-- Make the newly-added check-tray fields immediately visible to the API.
notify pgrst, 'reload schema';
