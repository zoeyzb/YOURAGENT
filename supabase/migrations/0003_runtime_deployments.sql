create table if not exists runtime_deployments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  agent_version integer not null,
  provider text not null,
  external_deployment_id text not null,
  status text not null check (status in ('ready','paused','failed')),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_deployment_id)
);

create index if not exists runtime_deployments_agent_idx
  on runtime_deployments(agent_id, created_at desc);

alter table runtime_deployments enable row level security;

create policy "members can read runtime deployments in their org" on runtime_deployments
for select to authenticated
using (exists (
  select 1 from organization_members m
  where m.organization_id = runtime_deployments.organization_id
    and m.user_id = (select auth.uid())
));

create policy "admins can mutate runtime deployments in their org" on runtime_deployments
for all to authenticated
using (exists (
  select 1 from organization_members m
  where m.organization_id = runtime_deployments.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
))
with check (exists (
  select 1 from organization_members m
  where m.organization_id = runtime_deployments.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
));
