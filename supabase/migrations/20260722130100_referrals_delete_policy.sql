drop policy if exists "Users can delete own referrals" on public.referrals;
create policy "Users can delete own referrals"
  on public.referrals for delete to authenticated
  using (
    auth.uid() = referrer_user_id
    or auth.uid() = referred_user_id
  );
