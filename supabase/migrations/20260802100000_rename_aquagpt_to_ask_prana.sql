-- Rename AquaGPT → Ask Prana branding (tables, indexes, storage bucket).
-- Preserves all data, constraints, and RLS policies via ALTER RENAME.

-- 1) Tables
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'aquagpt_sessions'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ask_prana_sessions'
  ) THEN
    ALTER TABLE public.aquagpt_sessions RENAME TO ask_prana_sessions;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'aquagpt_messages'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ask_prana_messages'
  ) THEN
    ALTER TABLE public.aquagpt_messages RENAME TO ask_prana_messages;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'aquagpt_usage'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'ask_prana_usage'
  ) THEN
    ALTER TABLE public.aquagpt_usage RENAME TO ask_prana_usage;
  END IF;
END $$;

-- 2) Indexes commonly named with aquagpt prefix (ignore if missing)
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname LIKE 'aquagpt%'
  LOOP
    EXECUTE format(
      'ALTER INDEX public.%I RENAME TO %I',
      r.indexname,
      regexp_replace(r.indexname, '^aquagpt', 'ask_prana')
    );
  END LOOP;
END $$;

-- 3) Storage bucket rename (id used by storage.from(...))
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'aquagpt-files')
     AND NOT EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'ask-prana-files') THEN
    -- storage.objects.bucket_id references buckets.id
    UPDATE storage.objects SET bucket_id = 'ask-prana-files' WHERE bucket_id = 'aquagpt-files';
    UPDATE storage.buckets SET id = 'ask-prana-files', name = 'ask-prana-files' WHERE id = 'aquagpt-files';
  END IF;
EXCEPTION
  WHEN others THEN
    -- If bucket id update is restricted, create alias bucket row is not possible;
    -- keep aquagpt-files and rely on app dual-read. Log and continue.
    RAISE NOTICE 'Storage bucket rename skipped: %', SQLERRM;
END $$;

-- 4) Realtime publication membership (if tables were added by name)
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.aquagpt_sessions;
  EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.aquagpt_messages;
  EXCEPTION WHEN undefined_table OR undefined_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ask_prana_sessions;
  EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.ask_prana_messages;
  EXCEPTION WHEN duplicate_object OR undefined_table OR undefined_object THEN NULL;
  END;
END $$;
