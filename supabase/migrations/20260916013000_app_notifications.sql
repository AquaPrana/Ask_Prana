-- Unified in-app notifications + extended preference categories for AquaPrana push.
-- Extends weather notification schema; does not replace weather_alerts.

-- ---------------------------------------------------------------------------
-- notification_preferences: category toggles + reminder schedule
-- ---------------------------------------------------------------------------
alter table public.notification_preferences
  add column if not exists water_quality_alerts_enabled boolean not null default true,
  add column if not exists inventory_alerts_enabled boolean not null default true,
  add column if not exists daily_log_reminder_enabled boolean not null default false,
  add column if not exists daily_log_reminder_time time default '18:00',
  add column if not exists water_test_reminder_enabled boolean not null default false,
  add column if not exists water_test_overdue_days integer not null default 2,
  add column if not exists feed_reminder_enabled boolean not null default false,
  add column if not exists treatment_reminder_enabled boolean not null default false,
  add column if not exists utc_offset_minutes integer not null default 330;

comment on column public.notification_preferences.daily_log_reminder_enabled is
  'When true and daily_log_reminder_time is set, cron may push overdue daily-log reminders.';
comment on column public.notification_preferences.water_test_overdue_days is
  'Days without a synced water reading before overdue reminder (only if water_test_reminder_enabled).';
comment on column public.notification_preferences.feed_reminder_enabled is
  'Reserved: no explicit feed schedule table exists yet — server skips until schedules exist.';
comment on column public.notification_preferences.treatment_reminder_enabled is
  'Reserved: no explicit treatment schedule table exists yet — server skips until schedules exist.';

-- ---------------------------------------------------------------------------
-- app_notifications: unified inbox (weather rows may also be mirrored here)
-- ---------------------------------------------------------------------------
create table if not exists public.app_notifications (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references auth.users (id) on delete cascade,
  pond_id uuid references public.ponds (id) on delete set null,
  category text not null
    check (category in (
      'weather',
      'water_quality',
      'inventory',
      'daily_log_reminder',
      'water_test_reminder',
      'feed_reminder',
      'treatment_reminder',
      'feed_adjustment',
      'cycle',
      'account',
      'test'
    )),
  severity text not null default 'routine'
    check (severity in ('routine', 'urgent')),
  title text not null,
  body text not null,
  action_hint text,
  deep_link text,
  data jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  weather_alert_id uuid references public.weather_alerts (id) on delete set null,
  read_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists app_notifications_open_dedupe_idx
  on public.app_notifications (farmer_id, dedupe_key)
  where resolved_at is null;

create index if not exists app_notifications_farmer_created_idx
  on public.app_notifications (farmer_id, created_at desc);

create index if not exists app_notifications_farmer_unread_idx
  on public.app_notifications (farmer_id)
  where read_at is null and resolved_at is null;

drop trigger if exists app_notifications_set_updated_at on public.app_notifications;
create trigger app_notifications_set_updated_at
  before update on public.app_notifications
  for each row execute function public.set_updated_at();

alter table public.app_notifications enable row level security;

drop policy if exists app_notifications_select_own on public.app_notifications;
create policy app_notifications_select_own
  on public.app_notifications for select to authenticated
  using (farmer_id = auth.uid());

drop policy if exists app_notifications_update_own on public.app_notifications;
create policy app_notifications_update_own
  on public.app_notifications for update to authenticated
  using (farmer_id = auth.uid())
  with check (farmer_id = auth.uid());

grant select, update on public.app_notifications to authenticated;
grant all on public.app_notifications to service_role;

-- ---------------------------------------------------------------------------
-- delivery logs: allow linking to app_notifications (weather alert still optional)
-- ---------------------------------------------------------------------------
alter table public.notification_delivery_logs
  add column if not exists app_notification_id uuid
    references public.app_notifications (id) on delete set null,
  add column if not exists expo_ticket_id text,
  add column if not exists expo_receipt_status text;

create index if not exists notification_delivery_logs_app_notification_idx
  on public.notification_delivery_logs (app_notification_id);

-- ---------------------------------------------------------------------------
-- Optional cron for process-app-notifications (requires pg_cron + pg_net)
-- Same pattern as weather; fails softly if extensions unavailable.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron')
     and exists (select 1 from pg_extension where extname = 'pg_net') then
    perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'process-app-notifications-every-30m';

    perform cron.schedule(
      'process-app-notifications-every-30m',
      '*/30 * * * *',
      $cron$
      select net.http_post(
        url := current_setting('app.settings.app_notifications_url', true),
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', current_setting('app.settings.cron_secret', true)
        ),
        body := '{}'::jsonb
      );
      $cron$
    );
  end if;
exception
  when others then
    raise notice 'process-app-notifications cron not scheduled: %', SQLERRM;
end $$;
