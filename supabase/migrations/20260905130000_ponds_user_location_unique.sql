-- Per-user unique pond locations using normalized latitude/longitude.
-- Location source of truth: public.ponds.latitude + public.ponds.longitude
-- Normalization: round to 5 decimal places (~1.1 m), matching the mobile app.
-- Fails safely if duplicate (user_id, normalized location) rows already exist.

DO $$
DECLARE
  duplicate_group record;
  duplicate_count integer := 0;
BEGIN
  FOR duplicate_group IN
    SELECT
      user_id,
      round(latitude::numeric, 5) AS normalized_latitude,
      round(longitude::numeric, 5) AS normalized_longitude,
      count(*) AS row_count,
      array_agg(id ORDER BY created_at NULLS LAST) AS pond_ids,
      array_agg(btrim(name) ORDER BY created_at NULLS LAST) AS pond_names
    FROM public.ponds
    WHERE latitude IS NOT NULL
      AND longitude IS NOT NULL
    GROUP BY user_id, round(latitude::numeric, 5), round(longitude::numeric, 5)
    HAVING count(*) > 1
  LOOP
    duplicate_count := duplicate_count + 1;
    RAISE WARNING
      'Duplicate pond location group %: user_id=%, lat=%, lng=%, count=%, ids=%, names=%',
      duplicate_count,
      duplicate_group.user_id,
      duplicate_group.normalized_latitude,
      duplicate_group.normalized_longitude,
      duplicate_group.row_count,
      duplicate_group.pond_ids,
      duplicate_group.pond_names;
  END LOOP;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot create ponds_user_id_location_normalized_unique: % duplicate (user_id, pond location) group(s) exist. Resolve duplicates manually, then re-run this migration.',
      duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ponds_user_id_location_normalized_unique
  ON public.ponds (
    user_id,
    round(latitude::numeric, 5),
    round(longitude::numeric, 5)
  )
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

COMMENT ON INDEX public.ponds_user_id_location_normalized_unique IS
  'Enforces unique pond GPS locations per user (rounded to 5 decimal places).';
