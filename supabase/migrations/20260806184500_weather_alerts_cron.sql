-- Schedule process-weather-alerts every 30 minutes via pg_cron + pg_net.
-- Requires project secrets: CRON_SECRET (or service role) on the edge function.
-- Replace project URL after deploy if needed; this uses current_setting vault pattern when available.

-- Safe no-op when extensions are unavailable (local/dev without cron).
do $$
begin
  create extension if not exists pg_cron with schema extensions;
  create extension if not exists pg_net with schema extensions;
exception
  when others then
    raise notice 'pg_cron/pg_net not available: %', sqlerrm;
end;
$$;

-- Helper: invoke weather processor. Uses app.settings or vault if configured.
create or replace function public.invoke_process_weather_alerts()
returns void
language plpgsql
security definer
as $$
declare
  v_url text;
  v_secret text;
begin
  v_url := current_setting('app.settings.weather_alerts_url', true);
  v_secret := current_setting('app.settings.cron_secret', true);

  if v_url is null or length(trim(v_url)) = 0 then
    raise notice 'weather alerts cron skipped: app.settings.weather_alerts_url not set';
    return;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', coalesce(v_secret, '')
    ),
    body := jsonb_build_object('source', 'pg_cron')
  );
exception
  when others then
    raise notice 'invoke_process_weather_alerts failed: %', sqlerrm;
end;
$$;

-- Schedule every 30 minutes (idempotent unschedule + schedule)
do $$
begin
  perform cron.unschedule('process-weather-alerts-every-30m');
exception
  when others then
    null;
end;
$$;

do $$
begin
  perform cron.schedule(
    'process-weather-alerts-every-30m',
    '*/30 * * * *',
    $cron$ select public.invoke_process_weather_alerts(); $cron$
  );
exception
  when others then
    raise notice 'Could not schedule weather cron: %', sqlerrm;
end;
$$;
