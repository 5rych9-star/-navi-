-- Run as the database owner after BOTH migrations, in a test project/database.
-- Synthetic records simulate data stored by an older app. Everything rolls back.
begin;
set local statement_timeout = '15s';

do $$
begin
  if exists (select 1 from auth.users where id in (
    'a10c2026-1028-4000-8000-000000000001'::uuid,
    'a10c2026-1028-4000-8000-000000000002'::uuid
  )) then
    raise exception 'Device-only test fixture IDs already exist; use a clean test database.';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'user_travel_data'
      and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'RLS must remain enabled and forced.';
  end if;
  if has_table_privilege('authenticated', 'public.user_travel_data', 'INSERT')
    or has_table_privilege('authenticated', 'public.user_travel_data', 'UPDATE')
    or has_table_privilege('authenticated', 'public.user_travel_data', 'TRUNCATE')
  then
    raise exception 'Application roles must not write travel data on the server.';
  end if;
end;
$$;

insert into auth.users (id, email) values
  ('a10c2026-1028-4000-8000-000000000001', 'device-owner-a@example.invalid'),
  ('a10c2026-1028-4000-8000-000000000002', 'device-owner-b@example.invalid');
insert into public.user_travel_data (user_id, profile, trips) values
  ('a10c2026-1028-4000-8000-000000000001', '{"nickname":"Legacy owner A"}', '[]'),
  ('a10c2026-1028-4000-8000-000000000002', '{"nickname":"Legacy owner B"}', '[]');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a10c2026-1028-4000-8000-000000000001', true);
select set_config('request.jwt.claims', '{"sub":"a10c2026-1028-4000-8000-000000000001","role":"authenticated"}', true);

do $$
declare affected integer;
begin
  if (select count(*) from public.user_travel_data) <> 1
    or (select profile->>'nickname' from public.user_travel_data) <> 'Legacy owner A'
  then
    raise exception 'Owner A must be able to retrieve only their legacy row.';
  end if;

  begin
    insert into public.user_travel_data (user_id, profile)
      values ('a10c2026-1028-4000-8000-000000000001', '{"home":{"lat":33.5,"lng":131.1}}');
    raise exception 'Legacy INSERT unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.user_travel_data set profile = '{"home":{"lat":33.5,"lng":131.1}}'
      where user_id = 'a10c2026-1028-4000-8000-000000000001';
    raise exception 'Legacy UPDATE unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.user_travel_data (user_id, profile)
      values ('a10c2026-1028-4000-8000-000000000001', '{}')
      on conflict (user_id) do update set profile = excluded.profile;
    raise exception 'Legacy UPSERT unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
  delete from public.user_travel_data where user_id = 'a10c2026-1028-4000-8000-000000000002';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Owner A unexpectedly deleted owner B data.'; end if;
  delete from public.user_travel_data where user_id = 'a10c2026-1028-4000-8000-000000000001';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Owner A cannot remove their migrated legacy data.'; end if;
end;
$$;

select set_config('request.jwt.claim.sub', 'a10c2026-1028-4000-8000-000000000002', true);
select set_config('request.jwt.claims', '{"sub":"a10c2026-1028-4000-8000-000000000002","role":"authenticated"}', true);
do $$
begin
  if (select count(*) from public.user_travel_data) <> 1
    or (select profile->>'nickname' from public.user_travel_data) <> 'Legacy owner B'
  then
    raise exception 'Owner B legacy row was not preserved.';
  end if;
end;
$$;

select set_config('request.jwt.claim.sub', '', true);
select set_config('request.jwt.claims', '{"role":"authenticated"}', true);
do $$
declare affected integer;
begin
  if exists (select 1 from public.user_travel_data) then
    raise exception 'Missing JWT subject unexpectedly exposed legacy data.';
  end if;
  delete from public.user_travel_data;
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Missing JWT subject unexpectedly deleted data.'; end if;
end;
$$;

reset role;
set local role anon;
do $$
begin
  begin
    perform 1 from public.user_travel_data;
    raise exception 'Anonymous SELECT unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.user_travel_data;
    raise exception 'Anonymous DELETE unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.user_travel_data (user_id) values ('a10c2026-1028-4000-8000-000000000001');
    raise exception 'Anonymous INSERT unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.user_travel_data set profile = null;
    raise exception 'Anonymous UPDATE unexpectedly succeeded.';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;
rollback;
