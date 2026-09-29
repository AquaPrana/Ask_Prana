-- Refer & Earn: referral codes, referral tracking, and reward coupons.

alter table public.users
  add column if not exists referral_code text;

create unique index if not exists users_referral_code_uidx
  on public.users (referral_code)
  where referral_code is not null;

create table if not exists public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_user_id uuid not null references auth.users (id) on delete cascade,
  referred_user_id uuid references auth.users (id) on delete set null,
  referral_code text not null,
  status text not null default 'pending'
    check (status in ('pending', 'successful', 'rejected')),
  created_at timestamptz not null default now(),
  constraint referrals_referred_user_unique unique (referred_user_id)
);

create index if not exists referrals_referrer_idx
  on public.referrals (referrer_user_id);

create index if not exists referrals_code_idx
  on public.referrals (referral_code);

create table if not exists public.reward_coupons (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  coupon_code text not null,
  reward_amount numeric(10, 2) not null default 100,
  title text,
  expiry_date date,
  redeemed boolean not null default false,
  referral_id uuid references public.referrals (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists reward_coupons_user_idx
  on public.reward_coupons (user_id);

alter table public.referrals enable row level security;
alter table public.reward_coupons enable row level security;

drop policy if exists "Users can select own referrals" on public.referrals;
create policy "Users can select own referrals"
  on public.referrals for select to authenticated
  using (
    auth.uid() = referrer_user_id
    or auth.uid() = referred_user_id
  );

drop policy if exists "Users can insert referrals as referred" on public.referrals;
create policy "Users can insert referrals as referred"
  on public.referrals for insert to authenticated
  with check (auth.uid() = referred_user_id);

drop policy if exists "Users can update own referrals as referrer" on public.referrals;
create policy "Users can update own referrals as referrer"
  on public.referrals for update to authenticated
  using (auth.uid() = referrer_user_id or auth.uid() = referred_user_id)
  with check (auth.uid() = referrer_user_id or auth.uid() = referred_user_id);

drop policy if exists "Users can select own reward coupons" on public.reward_coupons;
create policy "Users can select own reward coupons"
  on public.reward_coupons for select to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own reward coupons" on public.reward_coupons;
create policy "Users can insert own reward coupons"
  on public.reward_coupons for insert to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own reward coupons" on public.reward_coupons;
create policy "Users can update own reward coupons"
  on public.reward_coupons for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own reward coupons" on public.reward_coupons;
create policy "Users can delete own reward coupons"
  on public.reward_coupons for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists "Users can delete own referrals" on public.referrals;
create policy "Users can delete own referrals"
  on public.referrals for delete to authenticated
  using (
    auth.uid() = referrer_user_id
    or auth.uid() = referred_user_id
  );

-- Apply a referral code for the signed-in user (security definer for coupon grants).
create or replace function public.apply_referral_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text := upper(trim(coalesce(p_code, '')));
  v_referrer_id uuid;
  v_referral_id uuid;
  v_reward numeric := 100;
  v_expiry date := (current_date + interval '180 days')::date;
  v_referrer_coupon text;
  v_welcome_coupon text;
  v_existing uuid;
begin
  if v_user_id is null then
    return jsonb_build_object('ok', false, 'error', 'Not authenticated');
  end if;

  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'Referral code is required');
  end if;

  select id into v_referrer_id
  from public.users
  where upper(referral_code) = v_code
  limit 1;

  if v_referrer_id is null then
    return jsonb_build_object('ok', false, 'error', 'Invalid referral code');
  end if;

  if v_referrer_id = v_user_id then
    return jsonb_build_object('ok', false, 'error', 'You cannot use your own referral code');
  end if;

  select id into v_existing
  from public.referrals
  where referred_user_id = v_user_id
  limit 1;

  if v_existing is not null then
    return jsonb_build_object('ok', false, 'error', 'Referral already applied for this account');
  end if;

  insert into public.referrals (
    referrer_user_id,
    referred_user_id,
    referral_code,
    status
  )
  values (
    v_referrer_id,
    v_user_id,
    v_code,
    'successful'
  )
  returning id into v_referral_id;

  v_referrer_coupon := 'AQUA' || lpad((floor(random() * 90000) + 10000)::text, 5, '0');
  v_welcome_coupon := 'WELCOME' || lpad((floor(random() * 9000) + 1000)::text, 4, '0');

  insert into public.reward_coupons (
    user_id,
    coupon_code,
    reward_amount,
    title,
    expiry_date,
    redeemed,
    referral_id
  )
  values
    (
      v_referrer_id,
      v_referrer_coupon,
      v_reward,
      '₹' || v_reward::int || ' OFF',
      v_expiry,
      false,
      v_referral_id
    ),
    (
      v_user_id,
      v_welcome_coupon,
      v_reward,
      '₹' || v_reward::int || ' OFF Welcome',
      v_expiry,
      false,
      v_referral_id
    );

  return jsonb_build_object(
    'ok', true,
    'referral_id', v_referral_id,
    'reward_amount', v_reward
  );
end;
$$;

revoke all on function public.apply_referral_code(text) from public;
grant execute on function public.apply_referral_code(text) to authenticated;
