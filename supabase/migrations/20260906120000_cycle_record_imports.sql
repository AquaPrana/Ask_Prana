-- Cycle record import sessions for Join Existing Cycle → Upload past records.
-- Tracks uploaded files, AI extraction, validation, and confirmation status.
-- Additive / production-safe. Does not weaken existing RLS elsewhere.

create table if not exists public.cycle_record_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pond_id uuid not null references public.ponds (id) on delete cascade,
  cycle_id uuid null references public.crop_cycles (id) on delete set null,
  status text not null default 'UPLOADED'
    check (status in (
      'UPLOADED',
      'PROCESSING',
      'EXTRACTED',
      'NEEDS_REVIEW',
      'VALIDATED',
      'IMPORTED',
      'FAILED'
    )),
  source_files jsonb not null default '[]'::jsonb,
  extraction_raw jsonb null,
  extraction_normalized jsonb null,
  validation_report jsonb null,
  review_payload jsonb null,
  error_message text null,
  content_hash text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  imported_at timestamptz null
);

comment on table public.cycle_record_imports is
  'AI/OCR import sessions for Join Existing Cycle past-record uploads.';

comment on column public.cycle_record_imports.source_files is
  'JSON array: [{path, fileName, mimeType, remoteUrl, uploadedAt}]';

comment on column public.cycle_record_imports.content_hash is
  'Optional hash of storage paths to help detect re-upload of the same files.';

create index if not exists cycle_record_imports_user_created_idx
  on public.cycle_record_imports (user_id, created_at desc);

create index if not exists cycle_record_imports_pond_created_idx
  on public.cycle_record_imports (pond_id, created_at desc);

create index if not exists cycle_record_imports_status_idx
  on public.cycle_record_imports (status);

create unique index if not exists cycle_record_imports_user_content_hash_unique
  on public.cycle_record_imports (user_id, content_hash)
  where content_hash is not null and status = 'IMPORTED';

alter table public.cycle_record_imports enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'cycle_record_imports'
      and policyname = 'cycle_record_imports_owner_all'
  ) then
    create policy cycle_record_imports_owner_all
      on public.cycle_record_imports
      for all
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

grant select, insert, update, delete on public.cycle_record_imports to authenticated;
grant all on public.cycle_record_imports to service_role;
