-- Check Tray AI feed-intake analysis results (recommendation aid only).
-- Additive / production-safe.

create table if not exists public.check_tray_analyses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pond_id uuid not null references public.ponds (id) on delete cascade,
  cycle_id uuid null references public.crop_cycles (id) on delete set null,
  daily_log_id uuid null references public.pond_logs (id) on delete set null,
  image_refs jsonb not null default '[]'::jsonb,
  estimated_leftover_percent numeric null,
  leftover_feed_level text null,
  feed_intake text null,
  confidence numeric null,
  current_feed_quantity numeric null,
  recommended_change_percent numeric null,
  suggested_feed_quantity numeric null,
  recommended_action text null,
  recommendation_message text null,
  analysis_status text not null,
  image_results jsonb not null default '[]'::jsonb,
  pond_context jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.check_tray_analyses is
  'AI check-tray leftover-feed analysis + deterministic feed recommendation (aid only; never auto-applies feed).';

comment on column public.check_tray_analyses.image_refs is
  'JSON array of analyzed photo refs: [{url, path, fileName}]';

comment on column public.check_tray_analyses.analysis_status is
  'success | needs_better_image | error';

create index if not exists check_tray_analyses_pond_created_idx
  on public.check_tray_analyses (pond_id, created_at desc);

create index if not exists check_tray_analyses_cycle_created_idx
  on public.check_tray_analyses (cycle_id, created_at desc);

create index if not exists check_tray_analyses_daily_log_idx
  on public.check_tray_analyses (daily_log_id);

create index if not exists check_tray_analyses_user_created_idx
  on public.check_tray_analyses (user_id, created_at desc);

alter table public.check_tray_analyses enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'check_tray_analyses'
      and policyname = 'check_tray_analyses_owner_all'
  ) then
    create policy check_tray_analyses_owner_all
      on public.check_tray_analyses
      for all
      to authenticated
      using (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end $$;

grant select, insert, update, delete on public.check_tray_analyses to authenticated;
grant all on public.check_tray_analyses to service_role;
