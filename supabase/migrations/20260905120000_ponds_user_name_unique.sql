-- Per-user case-insensitive unique pond names (trimmed whitespace).
-- Does not apply globally across users.
-- Fails safely if duplicate (user_id, normalized name) rows already exist.

DO $$
DECLARE
  duplicate_group record;
  duplicate_count integer := 0;
BEGIN
  FOR duplicate_group IN
    SELECT
      user_id,
      lower(btrim(name)) AS normalized_name,
      count(*) AS row_count,
      array_agg(id ORDER BY created_at NULLS LAST) AS pond_ids,
      array_agg(btrim(name) ORDER BY created_at NULLS LAST) AS pond_names
    FROM public.ponds
    WHERE name IS NOT NULL
      AND btrim(name) <> ''
    GROUP BY user_id, lower(btrim(name))
    HAVING count(*) > 1
  LOOP
    duplicate_count := duplicate_count + 1;
    RAISE WARNING
      'Duplicate pond name group %: user_id=%, normalized_name=%, count=%, ids=%, names=%',
      duplicate_count,
      duplicate_group.user_id,
      duplicate_group.normalized_name,
      duplicate_group.row_count,
      duplicate_group.pond_ids,
      duplicate_group.pond_names;
  END LOOP;

  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Cannot create ponds_user_id_name_normalized_unique: % duplicate (user_id, pond name) group(s) exist. Resolve duplicates manually, then re-run this migration.',
      duplicate_count;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ponds_user_id_name_normalized_unique
  ON public.ponds (user_id, lower(btrim(name)))
  WHERE name IS NOT NULL AND btrim(name) <> '';

COMMENT ON INDEX public.ponds_user_id_name_normalized_unique IS
  'Enforces unique pond names per user (case-insensitive, trimmed).';
