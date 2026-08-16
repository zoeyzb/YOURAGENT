export const APP_SCHEMA_SQL = String.raw`
create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_user_id text not null,
  created_at timestamptz not null default now()
);

create table if not exists organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id text not null,
  role text not null check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);
create index if not exists organization_members_user_idx on organization_members(user_id);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  status text not null check (status in ('draft','testing','published','paused')) default 'draft',
  current_version integer not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists agents_org_created_idx on agents(organization_id, created_at desc);

create table if not exists agent_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  version integer not null,
  status text not null check (status in ('draft','testing','published','paused')),
  config jsonb not null,
  config_hash text not null,
  restored_from_version integer,
  created_at timestamptz not null default now(),
  unique(agent_id, version)
);
alter table agent_versions add column if not exists restored_from_version integer;
create index if not exists agent_versions_agent_idx on agent_versions(agent_id, version desc);

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  agent_version integer not null,
  provider_call_id text,
  runtime_provider text,
  external_run_id text,
  direction text not null check (direction in ('inbound','outbound')),
  status text not null,
  started_at timestamptz,
  ended_at timestamptz,
  transcript_url text,
  recording_url text,
  cost_info jsonb,
  usage_info jsonb,
  gathered_context jsonb,
  is_test boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists calls_runtime_run_unique
  on calls(runtime_provider, external_run_id)
  where runtime_provider is not null and external_run_id is not null;
create index if not exists calls_org_created_idx on calls(organization_id, created_at desc);

create table if not exists processed_events (
  event_id text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  processed_at timestamptz not null default now()
);

create table if not exists usage_events (
  event_id text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  call_id uuid references calls(id) on delete set null,
  type text not null,
  quantity numeric not null check (quantity >= 0),
  provider text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null
);

create table if not exists runtime_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider text not null check (provider in ('dograh')),
  base_url text not null,
  encrypted_api_key text not null,
  external_organization_id text,
  status text not null default 'active' check (status in ('active','disabled','error')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

create table if not exists runtime_deployments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  agent_version integer not null,
  provider text not null,
  external_deployment_id text not null,
  external_workflow_uuid text,
  webhook_token_hash text,
  status text not null check (status in ('ready','paused','failed')),
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_deployment_id)
);
create index if not exists runtime_deployments_agent_idx on runtime_deployments(agent_id, created_at desc);
create index if not exists runtime_deployments_workflow_uuid_idx
  on runtime_deployments(organization_id, external_workflow_uuid)
  where external_workflow_uuid is not null;
create unique index if not exists runtime_deployments_webhook_token_hash_unique
  on runtime_deployments(webhook_token_hash)
  where webhook_token_hash is not null;

create table if not exists runtime_test_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  agent_version integer not null,
  created_by text not null,
  provider text not null,
  external_deployment_id text not null,
  status text not null check (status in ('created','active','completed','failed','expired')) default 'created',
  workflow_run_id text,
  expires_at timestamptz not null,
  last_error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists runtime_test_sessions_agent_idx on runtime_test_sessions(agent_id, created_at desc);
create index if not exists runtime_test_sessions_owner_idx on runtime_test_sessions(created_by, created_at desc);

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
`;
