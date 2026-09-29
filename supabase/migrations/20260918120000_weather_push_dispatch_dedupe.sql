-- One backend submission per farmer, pond/farm scope, weather event, and push.
-- NULL ponds use a farm scope explicitly, avoiding PostgreSQL NULL uniqueness.
alter table public.notification_devices
  add column if not exists is_primary boolean not null default false;

create table if not exists public.weather_push_dispatches (
  id uuid primary key default gen_random_uuid(),
  farmer_id uuid not null references auth.users(id) on delete cascade,
  farm_id uuid not null references public.farm_locations(id) on delete cascade,
  pond_id uuid references public.ponds(id) on delete set null,
  scope_key text not null,
  weather_event_key text not null,
  channel text not null default 'push' check (channel = 'push'),
  alert_id uuid references public.weather_alerts(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending','sending','accepted','failed','unknown','skipped')),
  recipient text,
  provider text default 'expo',
  provider_ticket_id text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  accepted_at timestamptz
);

create unique index if not exists weather_push_dispatch_once_idx
  on public.weather_push_dispatches (farmer_id, scope_key, weather_event_key, channel);

drop trigger if exists weather_push_dispatches_set_updated_at on public.weather_push_dispatches;
create trigger weather_push_dispatches_set_updated_at before update on public.weather_push_dispatches
  for each row execute function public.set_updated_at();

create or replace function public.claim_weather_push_dispatch(
  p_farmer_id uuid, p_farm_id uuid, p_pond_id uuid, p_weather_event_key text, p_alert_id uuid
) returns table (id uuid)
language sql security definer set search_path = public as $$
  insert into public.weather_push_dispatches
    (farmer_id, farm_id, pond_id, scope_key, weather_event_key, channel, alert_id, status)
  values
    (p_farmer_id, p_farm_id, p_pond_id,
     case when p_pond_id is null then 'farm:' || p_farm_id::text else 'pond:' || p_pond_id::text end,
     p_weather_event_key, 'push', p_alert_id, 'pending')
  on conflict (farmer_id, scope_key, weather_event_key, channel) do nothing
  returning weather_push_dispatches.id;
$$;

alter table public.weather_push_dispatches enable row level security;
grant all on public.weather_push_dispatches to service_role;
revoke all on function public.claim_weather_push_dispatch(uuid, uuid, uuid, text, uuid) from public;
grant execute on function public.claim_weather_push_dispatch(uuid, uuid, uuid, text, uuid) to service_role;
