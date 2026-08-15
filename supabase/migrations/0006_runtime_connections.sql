create extension if not exists supabase_vault with schema vault;

alter table runtime_deployments add column if not exists metadata jsonb not null default '{}'::jsonb;

create table if not exists runtime_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  provider text not null check (provider in ('dograh')),
  base_url text not null,
  secret_id uuid,
  external_organization_id text,
  status text not null default 'active' check (status in ('active','disabled','error')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, provider)
);

alter table runtime_connections enable row level security;

create policy "members can read runtime connection metadata" on runtime_connections
for select to authenticated
using (exists (
  select 1 from organization_members m
  where m.organization_id = runtime_connections.organization_id
    and m.user_id = (select auth.uid())
));

create policy "admins can mutate runtime connection metadata" on runtime_connections
for all to authenticated
using (exists (
  select 1 from organization_members m
  where m.organization_id = runtime_connections.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
))
with check (exists (
  select 1 from organization_members m
  where m.organization_id = runtime_connections.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
));

-- Secrets themselves live encrypted in Supabase Vault. The application table stores
-- only the Vault UUID. This resolver is intentionally callable only by service_role.
create or replace function public.resolve_runtime_connection_secret(
  p_organization_id uuid,
  p_provider text
) returns table(base_url text, api_key text, external_organization_id text)
language sql
security definer
set search_path = public, vault
as $$
  select rc.base_url,
         ds.decrypted_secret as api_key,
         rc.external_organization_id
  from public.runtime_connections rc
  join vault.decrypted_secrets ds on ds.id = rc.secret_id
  where rc.organization_id = p_organization_id
    and rc.provider = p_provider
    and rc.status = 'active'
  limit 1;
$$;

revoke all on function public.resolve_runtime_connection_secret(uuid, text) from public;
revoke all on function public.resolve_runtime_connection_secret(uuid, text) from anon;
revoke all on function public.resolve_runtime_connection_secret(uuid, text) from authenticated;
grant execute on function public.resolve_runtime_connection_secret(uuid, text) to service_role;
