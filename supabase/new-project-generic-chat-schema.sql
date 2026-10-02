-- Run this only in the SQL Editor of the new Ask_Prana_Generic_Assistant
-- Supabase project. It is intentionally not a migration for the existing
-- AquaPrana production project.
--
-- Authentication is MSG91-based. The backend owns opaque application sessions;
-- do not expose a Supabase service-role key to the frontend.

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  phone text unique,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint app_users_has_identity check (email is not null or phone is not null),
  constraint app_users_email_normalized check (email is null or email = lower(btrim(email))),
  constraint app_users_phone_e164 check (phone is null or phone ~ '^\\+91[6-9][0-9]{9}$')
);

create table if not exists public.app_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists app_sessions_active_user_idx
  on public.app_sessions(user_id, expires_at)
  where revoked_at is null;

create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.app_users(id) on delete cascade,
  title text not null default 'New conversation',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_sessions_user_updated_idx
  on public.chat_sessions(user_id, updated_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  user_id uuid not null references public.app_users(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_created_idx
  on public.chat_messages(session_id, created_at);

-- The new project is backend-only for protected data. RLS remains enabled;
-- no browser client gets a policy or service-role credential.
alter table public.app_users enable row level security;
alter table public.app_sessions enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;
