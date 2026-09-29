-- Store last message preview on sessions for history list performance.
alter table public.aquagpt_sessions
  add column if not exists last_message text;
