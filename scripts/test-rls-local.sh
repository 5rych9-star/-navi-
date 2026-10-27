#!/usr/bin/env bash
# Execute the real migration and ownership tests in a disposable LOCAL database.
# Requires PostgreSQL server/client binaries; performs no package installation,
# network connection, or changes to an existing database. It does not exercise
# Supabase Auth, PostgREST, or a hosted Supabase project.
set -euo pipefail

if [[ "$(id -u)" == 0 ]]; then
  echo 'Run this disposable PostgreSQL test as an ordinary user, not root.' >&2
  exit 1
fi

navi_script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
navi_repo_dir="$(cd -- "$navi_script_dir/.." && pwd)"
navi_pg_bin="${NAVI_PG_BIN:-}"
if [[ -z "$navi_pg_bin" ]] && command -v initdb >/dev/null 2>&1; then
  navi_pg_bin="$(dirname -- "$(command -v initdb)")"
fi
if [[ -z "$navi_pg_bin" ]]; then
  for navi_candidate in /usr/lib/postgresql/{18,17,16,15}/bin; do
    if [[ -x "$navi_candidate/initdb" ]]; then
      navi_pg_bin="$navi_candidate"
      break
    fi
  done
fi
for navi_program in initdb pg_ctl psql; do
  if [[ -z "$navi_pg_bin" || ! -x "$navi_pg_bin/$navi_program" ]]; then
    echo 'PostgreSQL server/client binaries are required. Set NAVI_PG_BIN to their bin directory.' >&2
    exit 1
  fi
done

navi_test_dir="$(mktemp -d /tmp/nakatsu-rls.XXXXXX)"
navi_server_started=false
cleanup() {
  navi_test_status=$?
  trap - EXIT
  if [[ "$navi_server_started" == true ]]; then
    if ! "$navi_pg_bin/pg_ctl" -D "$navi_test_dir/data" -m fast -w stop > "$navi_test_dir/shutdown.log" 2>&1; then
      echo "Could not stop the test server. Inspect $navi_test_dir/shutdown.log before removing its directory." >&2
      exit 1
    fi
  fi
  if [[ "$navi_test_status" != 0 && -f "$navi_test_dir/postgres.log" ]]; then
    cat "$navi_test_dir/postgres.log" >&2
  fi
  rm -rf -- "$navi_test_dir"
  exit "$navi_test_status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir "$navi_test_dir/socket"
"$navi_pg_bin/initdb" -D "$navi_test_dir/data" -U postgres \
  --no-locale --encoding=UTF8 --auth-local=trust --auth-host=reject > "$navi_test_dir/initdb.log"
"$navi_pg_bin/pg_ctl" -D "$navi_test_dir/data" -l "$navi_test_dir/postgres.log" \
  -o "-c listen_addresses='' -c unix_socket_permissions=0700 -c jit=off -k $navi_test_dir/socket -p 55438" -w start
navi_server_started=true

cat > "$navi_test_dir/bootstrap.sql" <<'SQL'
-- Minimal local fixtures for the Supabase role/JWT ownership contract.
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid;
$$;
grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
-- Simulate permissive default table grants so the migration's REVOKE is tested.
alter default privileges for role postgres in schema public grant all on tables to anon, authenticated;
SQL

navi_psql=("$navi_pg_bin/psql" -h "$navi_test_dir/socket" -p 55438 -U postgres -d postgres -v ON_ERROR_STOP=1)
"${navi_psql[@]}" -f "$navi_test_dir/bootstrap.sql"
"${navi_psql[@]}" -f "$navi_repo_dir/supabase/migrations/202610270001_private_travel_data.sql"
"${navi_psql[@]}" -f "$navi_repo_dir/supabase/tests/private_travel_data.sql"
"${navi_psql[@]}" -f "$navi_repo_dir/supabase/migrations/202610280001_device_only_travel_data.sql"
"${navi_psql[@]}" -f "$navi_repo_dir/supabase/tests/device_only_travel_data.sql"
"${navi_psql[@]}" <<'SQL'
do $$
begin
  if exists (select 1 from auth.users) or exists (select 1 from public.user_travel_data) then
    raise exception 'The RLS fixtures were not rolled back.';
  end if;
end;
$$;
select 'Local PostgreSQL RLS checks passed. Hosted Supabase services were not exercised.' as result;
SQL
