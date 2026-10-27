-- Apply to the same Supabase project used by email/password authentication.
-- The browser uses a publishable key and each user's access token, never a
-- service-role key. RLS is the authorization boundary for every REST request.

create table public.user_travel_data (
  user_id uuid primary key references auth.users (id) on delete cascade,
  profile jsonb,
  trips jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default statement_timestamp(),
  constraint user_travel_data_profile_object
    check (profile is null or jsonb_typeof(profile) = 'object'),
  constraint user_travel_data_trips_array
    check (jsonb_typeof(trips) = 'array'),
  constraint user_travel_data_payload_limit
    check (octet_length(coalesce(profile::text, 'null')) + octet_length(trips::text) <= 1000000)
);

alter table public.user_travel_data enable row level security;
alter table public.user_travel_data force row level security;

-- In particular, remove Supabase default grants before granting only the
-- operations needed by this app. TRUNCATE and REFERENCES are not granted.
revoke all on table public.user_travel_data from public, anon, authenticated;
grant usage on schema public to authenticated;
grant select, insert, update, delete on table public.user_travel_data to authenticated;

create policy user_travel_data_select_own
  on public.user_travel_data for select to authenticated
  using ((select auth.uid()) = user_id);

create policy user_travel_data_insert_own
  on public.user_travel_data for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy user_travel_data_update_own
  on public.user_travel_data for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy user_travel_data_delete_own
  on public.user_travel_data for delete to authenticated
  using ((select auth.uid()) = user_id);

create function public.set_user_travel_data_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := statement_timestamp();
  return new;
end;
$$;

revoke all on function public.set_user_travel_data_updated_at() from public, anon, authenticated;

create trigger user_travel_data_updated_at
  before insert or update on public.user_travel_data
  for each row execute function public.set_user_travel_data_updated_at();
