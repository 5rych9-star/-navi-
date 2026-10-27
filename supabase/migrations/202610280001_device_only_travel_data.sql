-- Home coordinates also occur in saved-trip snapshots, route IDs and labels.
-- New clients store the entire travel record on the user's device. This table
-- is retained only to let each owner retrieve and then delete legacy records.
-- Do not delete unmigrated records here: a browser must first persist them.

revoke all on table public.user_travel_data from public, anon, authenticated;
grant select, delete on table public.user_travel_data to authenticated;

drop policy if exists user_travel_data_insert_own on public.user_travel_data;
drop policy if exists user_travel_data_update_own on public.user_travel_data;

-- Keep both SELECT and DELETE owner policies and forced RLS in place. Revoking
-- the grants AND removing write policies prevents old application tabs from
-- uploading home/plan data again. Administrator access remains an operations
-- responsibility; no administrator credential is supplied to the application.
