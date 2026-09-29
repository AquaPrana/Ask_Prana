-- Bluetooth devices, live sensor readings, and threshold alerts.

create table if not exists public.bluetooth_devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  pond_id uuid not null references public.ponds (id) on delete cascade,
  device_name text not null default 'Unknown Device',
  device_id text not null,
  service_uuid text,
  characteristic_uuid text,
  connected_at timestamptz,
  last_seen timestamptz default now(),
  connection_status text not null default 'disconnected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, pond_id, device_id)
);

create table if not exists public.sensor_readings (
  id uuid primary key default gen_random_uuid(),
  pond_id uuid not null references public.ponds (id) on delete cascade,
  device_id text not null,
  user_id uuid references auth.users (id) on delete set null,
  ph double precision,
  temperature double precision,
  do_mgl double precision,
  ammonia double precision,
  salinity double precision,
  alkalinity double precision,
  nitrite double precision,
  raw_payload text,
  created_at timestamptz not null default now()
);

create table if not exists public.sensor_alerts (
  id uuid primary key default gen_random_uuid(),
  pond_id uuid not null references public.ponds (id) on delete cascade,
  device_id text,
  user_id uuid references auth.users (id) on delete set null,
  parameter text not null,
  title text not null,
  message text not null,
  severity text not null default 'attention',
  value double precision,
  threshold_min double precision,
  threshold_max double precision,
  created_at timestamptz not null default now()
);

create index if not exists bluetooth_devices_pond_id_idx
  on public.bluetooth_devices (pond_id);

create index if not exists bluetooth_devices_user_id_idx
  on public.bluetooth_devices (user_id);

create index if not exists sensor_readings_pond_created_idx
  on public.sensor_readings (pond_id, created_at desc);

create index if not exists sensor_readings_device_created_idx
  on public.sensor_readings (device_id, created_at desc);

create index if not exists sensor_alerts_pond_created_idx
  on public.sensor_alerts (pond_id, created_at desc);

alter table public.bluetooth_devices enable row level security;
alter table public.sensor_readings enable row level security;
alter table public.sensor_alerts enable row level security;

-- Farmers: own rows via pond ownership / auth.uid
drop policy if exists "Users manage own bluetooth devices" on public.bluetooth_devices;
create policy "Users manage own bluetooth devices"
  on public.bluetooth_devices
  for all
  to authenticated
  using (user_id = auth.uid() or public.is_aquaprana_admin())
  with check (user_id = auth.uid() or public.is_aquaprana_admin());

drop policy if exists "Users manage own sensor readings" on public.sensor_readings;
create policy "Users manage own sensor readings"
  on public.sensor_readings
  for all
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_aquaprana_admin()
    or exists (
      select 1 from public.ponds p
      where p.id = sensor_readings.pond_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    or public.is_aquaprana_admin()
    or exists (
      select 1 from public.ponds p
      where p.id = sensor_readings.pond_id
        and p.user_id = auth.uid()
    )
  );

drop policy if exists "Users manage own sensor alerts" on public.sensor_alerts;
create policy "Users manage own sensor alerts"
  on public.sensor_alerts
  for all
  to authenticated
  using (
    user_id = auth.uid()
    or public.is_aquaprana_admin()
    or exists (
      select 1 from public.ponds p
      where p.id = sensor_alerts.pond_id
        and p.user_id = auth.uid()
    )
  )
  with check (
    user_id = auth.uid()
    or public.is_aquaprana_admin()
    or exists (
      select 1 from public.ponds p
      where p.id = sensor_alerts.pond_id
        and p.user_id = auth.uid()
    )
  );

-- Realtime for admin dashboard
do $$
begin
  alter publication supabase_realtime add table public.bluetooth_devices;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sensor_readings;
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter publication supabase_realtime add table public.sensor_alerts;
exception
  when duplicate_object then null;
end $$;

notify pgrst, 'reload schema';
