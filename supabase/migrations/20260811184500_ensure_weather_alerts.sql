-- Ensure weather alert infrastructure exists in the Data API schema (public).
-- Idempotent: safe to re-run. Does not drop data.
-- Root cause of PGRST205: migration 20260806183000 may not have been applied
-- to project xeptedkydokgpmyjkmsh, so PostgREST has no weather_alerts in cache.

create extension if not exists "pgcrypto";

grant usage on schema public to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Dependencies: farm_locations (FK for weather_alerts.farm_id)
-- ---------------------------------------------------------------------------
create table if not exists public.farm_locations (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references auth.users (id) on delete cascade,
  name text not null default 'My Farm',
  latitude double precision not null,
  longitude double precision not null,
  location_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint farm_locations_farmer_location_unique unique (farmer_id, location_key)
);

create index if not exists farm_locations_farmer_id_idx
  on public.farm_locations (farmer_id);

-- ---------------------------------------------------------------------------
-- weather_snapshots (used by process-weather-alerts edge function)
-- ---------------------------------------------------------------------------
create table if not exists public.weather_snapshots (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references public.farm_locations (id) on delete cascade,
  latitude double precision not null,
  longitude double precision not null,
  provider text not null default 'open-meteo',
  observed_at timestamptz not null,
  temperature_c numeric,
  apparent_temperature_c numeric,
  humidity_percent numeric,
  pressure_hpa numeric,
  precipitation_mm numeric,
  rain_mm numeric,
  rain_probability_percent numeric,
  wind_speed_kmh numeric,
  wind_gust_kmh numeric,
  wind_direction_degrees numeric,
  weather_code integer,
  raw_response jsonb,
  created_at timestamptz not null default now()
);

create index if not exists weather_snapshots_farm_observed_idx
  on public.weather_snapshots (farm_id, observed_at desc);

-- ---------------------------------------------------------------------------
-- weather_alerts (frontend SELECT + UPDATE; edge function INSERT/UPDATE)
-- Columns inferred from frontend/src/services/weatherAlerts.ts and
-- supabase/functions/process-weather-alerts/index.ts
-- ---------------------------------------------------------------------------
create table if not exists public.weather_alerts (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references auth.users (id) on delete cascade,
  farm_id uuid not null references public.farm_locations (id) on delete cascade,
  pond_id uuid references public.ponds (id) on delete set null,
  crop_cycle_id uuid,
  alert_type text not null,
  risk_level text not null
    check (risk_level in ('green', 'yellow', 'orange', 'red')),
  title text not null,
  message text not null,
  recommended_action text,
  message_key text,
  message_vars jsonb not null default '{}'::jsonb,
  forecast_start timestamptz,
  forecast_end timestamptz,
  weather_snapshot jsonb,
  pond_snapshot jsonb,
  status text not null default 'active'
    check (status in (
      'active',
      'acknowledged',
      'resolved',
      'expired',
      'read'
    )),
  requires_acknowledgement boolean not null default false,
  acknowledged_at timestamptz,
  read_at timestamptz,
  expires_at timestamptz,
  last_notified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists weather_alerts_farmer_status_idx
  on public.weather_alerts (farmer_id, status, created_at desc);

create index if not exists weather_alerts_dedupe_idx
  on public.weather_alerts (
    farmer_id,
    farm_id,
    pond_id,
    alert_type,
    risk_level,
    status
  );

create index if not exists weather_alerts_forecast_idx
  on public.weather_alerts (forecast_start, forecast_end);

-- ---------------------------------------------------------------------------
-- Supporting notification tables (same original migration family)
-- ---------------------------------------------------------------------------
create table if not exists public.notification_devices (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references auth.users (id) on delete cascade,
  expo_push_token text not null,
  platform text,
  device_id text,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_devices_token_unique unique (expo_push_token)
);

create index if not exists notification_devices_farmer_active_idx
  on public.notification_devices (farmer_id, is_active);

create table if not exists public.notification_preferences (
  farmer_id uuid primary key references auth.users (id) on delete cascade,
  weather_alerts_enabled boolean not null default true,
  yellow_push_enabled boolean not null default true,
  orange_push_enabled boolean not null default true,
  red_push_enabled boolean not null default true,
  whatsapp_enabled boolean not null default false,
  sms_enabled boolean not null default false,
  preferred_language text not null default 'en',
  quiet_hours_start time,
  quiet_hours_end time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_delivery_logs (
  id uuid primary key default gen_random_uuid(),
  alert_id uuid references public.weather_alerts (id) on delete set null,
  farmer_id uuid not null references auth.users (id) on delete cascade,
  channel text not null
    check (channel in ('push', 'whatsapp', 'sms', 'in_app')),
  recipient text,
  provider text,
  status text not null
    check (status in (
      'queued',
      'sent',
      'delivered',
      'failed',
      'skipped'
    )),
  provider_message_id text,
  error_message text,
  attempted_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists notification_delivery_logs_farmer_idx
  on public.notification_delivery_logs (farmer_id, attempted_at desc);

create index if not exists notification_delivery_logs_alert_idx
  on public.notification_delivery_logs (alert_id);

-- ---------------------------------------------------------------------------
-- updated_at helper + triggers
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists farm_locations_set_updated_at on public.farm_locations;
create trigger farm_locations_set_updated_at
  before update on public.farm_locations
  for each row execute function public.set_updated_at();

drop trigger if exists weather_alerts_set_updated_at on public.weather_alerts;
create trigger weather_alerts_set_updated_at
  before update on public.weather_alerts
  for each row execute function public.set_updated_at();

drop trigger if exists notification_devices_set_updated_at
  on public.notification_devices;
create trigger notification_devices_set_updated_at
  before update on public.notification_devices
  for each row execute function public.set_updated_at();

drop trigger if exists notification_preferences_set_updated_at
  on public.notification_preferences;
create trigger notification_preferences_set_updated_at
  before update on public.notification_preferences
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS (keep enabled; farmers read/update own alerts only)
-- ---------------------------------------------------------------------------
alter table public.farm_locations enable row level security;
alter table public.weather_snapshots enable row level security;
alter table public.weather_alerts enable row level security;
alter table public.notification_devices enable row level security;
alter table public.notification_preferences enable row level security;
alter table public.notification_delivery_logs enable row level security;

drop policy if exists farm_locations_select_own on public.farm_locations;
create policy farm_locations_select_own
  on public.farm_locations for select
  using (farmer_id = auth.uid());

drop policy if exists weather_snapshots_select_own on public.weather_snapshots;
create policy weather_snapshots_select_own
  on public.weather_snapshots for select
  using (
    exists (
      select 1
      from public.farm_locations fl
      where fl.id = weather_snapshots.farm_id
        and fl.farmer_id = auth.uid()
    )
  );

drop policy if exists weather_alerts_select_own on public.weather_alerts;
create policy weather_alerts_select_own
  on public.weather_alerts for select
  using (farmer_id = auth.uid());

drop policy if exists weather_alerts_update_own on public.weather_alerts;
create policy weather_alerts_update_own
  on public.weather_alerts for update
  using (farmer_id = auth.uid())
  with check (farmer_id = auth.uid());

drop policy if exists notification_devices_select_own on public.notification_devices;
create policy notification_devices_select_own
  on public.notification_devices for select
  using (farmer_id = auth.uid());

drop policy if exists notification_devices_insert_own on public.notification_devices;
create policy notification_devices_insert_own
  on public.notification_devices for insert
  with check (farmer_id = auth.uid());

drop policy if exists notification_devices_update_own on public.notification_devices;
create policy notification_devices_update_own
  on public.notification_devices for update
  using (farmer_id = auth.uid())
  with check (farmer_id = auth.uid());

drop policy if exists notification_preferences_select_own
  on public.notification_preferences;
create policy notification_preferences_select_own
  on public.notification_preferences for select
  using (farmer_id = auth.uid());

drop policy if exists notification_preferences_insert_own
  on public.notification_preferences;
create policy notification_preferences_insert_own
  on public.notification_preferences for insert
  with check (farmer_id = auth.uid());

drop policy if exists notification_preferences_update_own
  on public.notification_preferences;
create policy notification_preferences_update_own
  on public.notification_preferences for update
  using (farmer_id = auth.uid())
  with check (farmer_id = auth.uid());

drop policy if exists notification_delivery_logs_select_own
  on public.notification_delivery_logs;
create policy notification_delivery_logs_select_own
  on public.notification_delivery_logs for select
  using (farmer_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Grants
-- Frontend (authenticated): SELECT + UPDATE on weather_alerts (mark read / ack)
-- Edge function (service_role): full access for inserts
-- anon: SELECT only (RLS still requires auth.uid(); no browser INSERT)
-- ---------------------------------------------------------------------------
grant select on public.farm_locations to anon, authenticated;
grant select on public.weather_snapshots to anon, authenticated;
grant select on public.weather_alerts to anon, authenticated;
grant update on public.weather_alerts to authenticated;
grant select, insert, update on public.notification_devices to authenticated;
grant select, insert, update on public.notification_preferences to authenticated;
grant select on public.notification_delivery_logs to authenticated;

grant all on public.farm_locations to service_role;
grant all on public.weather_snapshots to service_role;
grant all on public.weather_alerts to service_role;
grant all on public.notification_devices to service_role;
grant all on public.notification_preferences to service_role;
grant all on public.notification_delivery_logs to service_role;

-- Expose to PostgREST Data API
notify pgrst, 'reload schema';
