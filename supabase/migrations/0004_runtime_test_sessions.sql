create table if not exists runtime_test_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  agent_id uuid not null references agents(id) on delete cascade,
  agent_version integer not null,
  created_by uuid not null,
  provider text not null,
  external_deployment_id text not null,
  status text not null check (status in ('created','active','completed','failed','expired')) default 'created',
  workflow_run_id text,
  expires_at timestamptz not null,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists runtime_test_sessions_agent_idx
  on runtime_test_sessions(agent_id, created_at desc);
create index if not exists runtime_test_sessions_owner_idx
  on runtime_test_sessions(created_by, created_at desc);

alter table runtime_test_sessions enable row level security;

create policy "members can read test sessions in their org" on runtime_test_sessions
for select to authenticated
using (exists (
  select 1 from organization_members m
  where m.organization_id = runtime_test_sessions.organization_id
    and m.user_id = (select auth.uid())
));

create policy "admins can create test sessions in their org" on runtime_test_sessions
for insert to authenticated
with check (
  created_by = (select auth.uid())
  and exists (
    select 1 from organization_members m
    where m.organization_id = runtime_test_sessions.organization_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner','admin')
  )
);

create policy "owners can update their test sessions" on runtime_test_sessions
for update to authenticated
using (
  created_by = (select auth.uid())
  and exists (
    select 1 from organization_members m
    where m.organization_id = runtime_test_sessions.organization_id
      and m.user_id = (select auth.uid())
      and m.role in ('owner','admin')
  )
)
with check (created_by = (select auth.uid()));
