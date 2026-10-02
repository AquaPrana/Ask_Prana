-- Ask Prana accounts live in public.users. Sessions are opaque application
-- tokens in public.user_sessions. This does not use Supabase Auth and does
-- not touch any AquaPrana project.
--
-- Existing phone rows are NOT rewritten or deleted. Two rows already store
-- the same Indian mobile in different formats, so a canonical unique phone
-- index is in the following migration and must not be applied until those
-- rows are resolved by hand.

create extension if not exists pgcrypto;

alter table public.users add column if not exists email text;

-- New accounts are created by the Ask Prana backend, not by auth.users.
alter table public.users alter column id set default gen_random_uuid();
alter table public.users drop constraint if exists users_id_fkey;

-- Indian mobiles become +91XXXXXXXXXX. Other numbers that already include a
-- country code keep that country code. Blank and unusable values become null.
create or replace function public.ask_prana_phone_canonical(raw text)
returns text
language plpgsql
immutable
as $$
declare
  trimmed text;
  digits text;
begin
  if raw is null then
    return null;
  end if;
  trimmed := btrim(raw);
  if trimmed = '' then
    return null;
  end if;
  digits := regexp_replace(trimmed, '\D', '', 'g');
  if trimmed ~ '^\+' and digits ~ '^91[6-9][0-9]{9}$' then
    return '+' || digits;
  end if;
  if digits ~ '^0[6-9][0-9]{9}$' then
    return '+91' || substring(digits from 2);
  end if;
  if digits ~ '^[6-9][0-9]{9}$' then
    return '+91' || digits;
  end if;
  if digits ~ '^91[6-9][0-9]{9}$' then
    return '+' || digits;
  end if;
  if trimmed ~ '^\+' and digits ~ '^[1-9][0-9]{7,14}$' then
    return '+' || digits;
  end if;
  return null;
end;
$$;

create or replace function public.ask_prana_normalize_user_identity()
returns trigger
language plpgsql
as $$
begin
  if new.email is not null then
    new.email := lower(btrim(new.email));
    if new.email = '' then
      new.email := null;
    end if;
  end if;
  if new.phone is not null then
    new.phone := public.ask_prana_phone_canonical(new.phone);
  end if;
  return new;
end;
$$;

drop trigger if exists users_normalize_identity on public.users;
create trigger users_normalize_identity
  before insert or update of email, phone
  on public.users
  for each row
  execute function public.ask_prana_normalize_user_identity();

-- Email is unique on its own. Phone keeps its existing exact-value unique
-- index. New writes are stored in canonical form, so that index blocks a
-- second insert of the same normalized phone.
create unique index if not exists users_email_uidx
  on public.users (email)
  where email is not null;

alter table public.users drop constraint if exists users_email_normalized;
alter table public.users
  add constraint users_email_normalized
  check (email is null or email = lower(btrim(email)));

create table if not exists public.user_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists user_sessions_active_user_idx
  on public.user_sessions (user_id, expires_at)
  where revoked_at is null;

alter table public.user_sessions enable row level security;
revoke all on table public.user_sessions from anon, authenticated;
grant all on table public.user_sessions to service_role;

notify pgrst, 'reload schema';
