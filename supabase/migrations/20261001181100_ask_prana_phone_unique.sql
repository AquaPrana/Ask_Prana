-- Canonical phone uniqueness. Refuses to add the index when normalized
-- duplicates already exist. Do not delete those rows in this migration.

do $$
declare
  conflicts text;
begin
  select string_agg(format('%s (stored phone %s)', id, phone), '; ' order by id)
    into conflicts
  from public.users
  where public.ask_prana_phone_canonical(phone) in (
    select public.ask_prana_phone_canonical(phone)
    from public.users
    where phone is not null and btrim(phone) <> ''
    group by public.ask_prana_phone_canonical(phone)
    having count(*) > 1
  );

  if conflicts is not null then
    raise exception
      'Refusing unique phone index. Resolve these normalized duplicates manually, then rerun this migration: %',
      conflicts;
  end if;
end;
$$;

create unique index if not exists users_phone_canonical_uidx
  on public.users (public.ask_prana_phone_canonical(phone))
  where public.ask_prana_phone_canonical(phone) is not null;
