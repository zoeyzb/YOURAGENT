-- Supabase projects created after the 2026 Data API exposure change do not
-- automatically grant table privileges to API roles. Keep grants explicit and
-- let RLS remain the row-level authorization boundary.

grant usage on schema public to authenticated;

grant select, insert, delete on table public.organizations to authenticated;
grant select, insert on table public.organization_members to authenticated;
grant select, insert, update, delete on table public.agents to authenticated;
grant select, insert, update, delete on table public.agent_versions to authenticated;
grant select, insert, update on table public.calls to authenticated;
grant select on table public.processed_events to authenticated;
grant select on table public.usage_events to authenticated;
grant select, insert, update, delete on table public.runtime_deployments to authenticated;
grant select, insert, update on table public.runtime_test_sessions to authenticated;
grant select on table public.runtime_connections to authenticated;
grant select, insert, update, delete on table public.telephony_connections to authenticated;
grant select, insert, update, delete on table public.phone_number_routes to authenticated;

-- Outbound dispatch, browser-test ingestion, and manual run reconciliation all
-- write call evidence through the authenticated server client. They must be
-- owner/admin scoped just like deployment and telephony mutations.
drop policy if exists "admins can mutate calls in their org" on public.calls;
create policy "admins can mutate calls in their org" on public.calls
for all to authenticated
using (exists (
  select 1
  from public.organization_members m
  where m.organization_id = calls.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner', 'admin')
))
with check (exists (
  select 1
  from public.organization_members m
  where m.organization_id = calls.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner', 'admin')
));
