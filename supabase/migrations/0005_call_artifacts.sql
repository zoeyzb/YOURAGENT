alter table calls add column if not exists runtime_provider text;
alter table calls add column if not exists external_run_id text;
alter table calls add column if not exists transcript_url text;
alter table calls add column if not exists recording_url text;
alter table calls add column if not exists cost_info jsonb;
alter table calls add column if not exists usage_info jsonb;
alter table calls add column if not exists gathered_context jsonb;
alter table calls add column if not exists is_test boolean not null default false;

create unique index if not exists calls_runtime_run_unique
  on calls(runtime_provider, external_run_id)
  where external_run_id is not null;

create policy "admins can mutate calls in their org" on calls
for all to authenticated
using (exists (
  select 1 from organization_members m
  where m.organization_id = calls.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
))
with check (exists (
  select 1 from organization_members m
  where m.organization_id = calls.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
));
