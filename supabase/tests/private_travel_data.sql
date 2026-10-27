-- Run AFTER the migration as the privileged database owner (e.g. postgres),
-- not through an application/service-role HTTP request. No pgTAP is needed.
-- Example: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/private_travel_data.sql
-- All fixtures and modifications roll back. This script has not been run
-- against a live Supabase project by the application unit test suite.

begin;
set local statement_timeout = '15s';

do $$
begin
  if exists (select 1 from auth.users where id in (
    'a10c2026-1027-4000-8000-000000000001'::uuid,
    'a10c2026-1027-4000-8000-000000000002'::uuid
  )) then
    raise exception 'RLS test fixture IDs already exist; use a clean test database.';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'user_travel_data'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'RLS must be enabled and forced.';
  end if;
end;
$$;

insert into auth.users (id, email) values
  ('a10c2026-1027-4000-8000-000000000001', 'rls-owner-a@example.invalid'),
  ('a10c2026-1027-4000-8000-000000000002', 'rls-owner-b@example.invalid');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a10c2026-1027-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a10c2026-1027-4000-8000-000000000001","role":"authenticated"}', true);

insert into public.user_travel_data (user_id, profile) values (
  'a10c2026-1027-4000-8000-000000000001',
  '{"nickname":"RLS owner A","home":{"id":"oki","label":"サンプル地域","lat":33.5856,"lng":131.1964}}'
);

do $$
declare affected integer;
begin
  if (select count(*) from public.user_travel_data) <> 1 then
    raise exception 'Owner A cannot read their own row.';
  end if;
  update public.user_travel_data set profile = jsonb_set(profile, '{nickname}', '"Owner A updated"')
    where user_id = 'a10c2026-1027-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner A cannot update their own row.'; end if;

  begin
    insert into public.user_travel_data (user_id) values ('a10c2026-1027-4000-8000-000000000002');
    raise exception 'Owner A unexpectedly inserted a row owned by B.';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.user_travel_data set user_id = 'a10c2026-1027-4000-8000-000000000002';
    raise exception 'Owner A unexpectedly changed row ownership to B.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', 'a10c2026-1027-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"a10c2026-1027-4000-8000-000000000002","role":"authenticated"}', true);

do $$
declare affected integer;
begin
  if (select count(*) from public.user_travel_data) <> 0 then
    raise exception 'Owner B unexpectedly read owner A data.';
  end if;
  update public.user_travel_data set profile = null
    where user_id = 'a10c2026-1027-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Owner B unexpectedly updated owner A data.'; end if;
  delete from public.user_travel_data where user_id = 'a10c2026-1027-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Owner B unexpectedly deleted owner A data.'; end if;
  begin
    insert into public.user_travel_data (user_id, profile)
      values ('a10c2026-1027-4000-8000-000000000001', null)
      on conflict (user_id) do update set profile = excluded.profile;
    raise exception 'Owner B unexpectedly upserted owner A data.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

insert into public.user_travel_data (user_id, profile) values (
  'a10c2026-1027-4000-8000-000000000002',
  '{"nickname":"RLS owner B","home":{"id":"osada","label":"サンプル地域","lat":33.5665,"lng":131.2047}}'
);

do $$
begin
  if (select count(*) from public.user_travel_data) <> 1 then
    raise exception 'Owner B cannot read their own row exclusively.';
  end if;
  begin
    update public.user_travel_data set profile = '[]'::jsonb;
    raise exception 'A profile array unexpectedly passed the shape constraint.';
  exception when check_violation then null;
  end;
  begin
    update public.user_travel_data set trips = '{}'::jsonb;
    raise exception 'A trips object unexpectedly passed the shape constraint.';
  exception when check_violation then null;
  end;
  begin
    update public.user_travel_data set profile = jsonb_build_object('oversized', repeat('x', 1000001));
    raise exception 'An oversized payload unexpectedly passed the size constraint.';
  exception when check_violation then null;
  end;
end;
$$;

select set_config('request.jwt.claim.sub', 'a10c2026-1027-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a10c2026-1027-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare affected integer;
begin
  if (select profile->>'nickname' from public.user_travel_data) is distinct from 'Owner A updated' then
    raise exception 'Owner A data was not preserved.';
  end if;
  delete from public.user_travel_data where user_id = 'a10c2026-1027-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner A cannot delete their own row.'; end if;
  if (select count(*) from public.user_travel_data) <> 0 then
    raise exception 'Owner A unexpectedly sees another owner after deleting their row.';
  end if;
end;
$$;

-- An authenticated role without a subject must also have no data access.
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.user_travel_data) <> 0 then
    raise exception 'A missing JWT subject unexpectedly exposed data.';
  end if;
  begin
    insert into public.user_travel_data (user_id) values ('a10c2026-1027-4000-8000-000000000001');
    raise exception 'A missing JWT subject unexpectedly inserted data.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"anon"}', true);

do $$
begin
  begin
    perform 1 from public.user_travel_data;
    raise exception 'Anonymous SELECT unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.user_travel_data (user_id) values ('a10c2026-1027-4000-8000-000000000001');
    raise exception 'Anonymous INSERT unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.user_travel_data set profile = null;
    raise exception 'Anonymous UPDATE unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.user_travel_data;
    raise exception 'Anonymous DELETE unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
end;
$$;

reset role;
rollback;
