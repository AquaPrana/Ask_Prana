-- Soft-archive support for ponds (My Ponds All / Archived tabs).

alter table public.ponds
  add column if not exists archived boolean not null default false,
  add column if not exists is_active boolean not null default true;

-- Backfill: active ponds should remain active when not archived.
update public.ponds
set is_active = true
where archived = false
  and is_active is distinct from true;

comment on column public.ponds.archived is 'When true, pond is hidden from All Ponds and shown under Archived.';
comment on column public.ponds.is_active is 'Inverse of archived for legacy/active listings.';
