create extension if not exists pgcrypto;

create table if not exists organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null,
  role text not null check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table if not exists agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  status text not null check (status in ('draft','testing','published','paused')) default 'draft',
  current_version integer not null default 1,
  created_at timestamptz not null default now()
);

create table if not exists agent_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  version integer not null,
  status text not null check (status in ('draft','testing','published','paused')),
  config jsonb not null,
  config_hash text not null,
  created_at timestamptz not null default now(),
  unique(agent_id, version)
);

create table if not exists calls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  agent_version integer not null,
  provider_call_id text,
  direction text not null check (direction in ('inbound','outbound')),
  status text not null,
  started_at timestamptz,
  ended_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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

alter table organizations enable row level security;
alter table organization_members enable row level security;
alter table agents enable row level security;
alter table agent_versions enable row level security;
alter table calls enable row level security;
alter table processed_events enable row level security;
alter table usage_events enable row level security;

create policy "members can read their organizations" on organizations
for select using (exists (
  select 1 from organization_members m where m.organization_id = organizations.id and m.user_id = auth.uid()
));

create policy "members can read memberships in their org" on organization_members
for select using (exists (
  select 1 from organization_members mine where mine.organization_id = organization_members.organization_id and mine.user_id = auth.uid()
));

create policy "members can read agents in their org" on agents
for select using (exists (
  select 1 from organization_members m where m.organization_id = agents.organization_id and m.user_id = auth.uid()
));

create policy "admins can mutate agents in their org" on agents
for all using (exists (
  select 1 from organization_members m where m.organization_id = agents.organization_id and m.user_id = auth.uid() and m.role in ('owner','admin')
)) with check (exists (
  select 1 from organization_members m where m.organization_id = agents.organization_id and m.user_id = auth.uid() and m.role in ('owner','admin')
));

create policy "members can read agent versions in their org" on agent_versions
for select using (exists (
  select 1 from organization_members m where m.organization_id = agent_versions.organization_id and m.user_id = auth.uid()
));

create policy "members can read calls in their org" on calls
for select using (exists (
  select 1 from organization_members m where m.organization_id = calls.organization_id and m.user_id = auth.uid()
));

create policy "members can read usage in their org" on usage_events
for select using (exists (
  select 1 from organization_members m where m.organization_id = usage_events.organization_id and m.user_id = auth.uid()
));
