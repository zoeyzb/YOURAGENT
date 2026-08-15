create table if not exists telephony_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider text not null check (provider in ('twilio')),
  external_config_id text not null,
  name text not null,
  status text not null default 'active' check (status in ('active','disabled','error')),
  is_default_outbound boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider, external_config_id)
);

create table if not exists phone_number_routes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  telephony_connection_id uuid not null references telephony_connections(id) on delete cascade,
  external_phone_number_id text not null,
  address text not null,
  label text,
  agent_id uuid references agents(id) on delete set null,
  external_workflow_id text,
  is_active boolean not null default true,
  is_default_caller_id boolean not null default false,
  provider_sync_ok boolean,
  provider_sync_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (telephony_connection_id, external_phone_number_id),
  unique (organization_id, address)
);

alter table telephony_connections enable row level security;
alter table phone_number_routes enable row level security;

create policy "members can read telephony connections in their org" on telephony_connections
for select to authenticated
using (exists (
  select 1 from organization_members m
  where m.organization_id = telephony_connections.organization_id
    and m.user_id = (select auth.uid())
));

create policy "admins can mutate telephony connections in their org" on telephony_connections
for all to authenticated
using (exists (
  select 1 from organization_members m
  where m.organization_id = telephony_connections.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
))
with check (exists (
  select 1 from organization_members m
  where m.organization_id = telephony_connections.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
));

create policy "members can read phone routes in their org" on phone_number_routes
for select to authenticated
using (exists (
  select 1 from organization_members m
  where m.organization_id = phone_number_routes.organization_id
    and m.user_id = (select auth.uid())
));

create policy "admins can mutate phone routes in their org" on phone_number_routes
for all to authenticated
using (exists (
  select 1 from organization_members m
  where m.organization_id = phone_number_routes.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
))
with check (exists (
  select 1 from organization_members m
  where m.organization_id = phone_number_routes.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
));
