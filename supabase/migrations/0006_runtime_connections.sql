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

create or replace function public.upsert_runtime_connection_secret(
  p_organization_id uuid,
  p_provider text,
  p_base_url text,
  p_api_key text,
  p_external_organization_id text default null,
  p_metadata jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  existing_secret_id uuid;
  next_secret_id uuid;
begin
  if p_provider <> 'dograh' then
    raise exception 'unsupported runtime provider';
  end if;
  if length(trim(p_base_url)) = 0 or length(trim(p_api_key)) = 0 then
    raise exception 'runtime base URL and API key are required';
  end if;

  select secret_id into existing_secret_id
  from public.runtime_connections
  where organization_id = p_organization_id and provider = p_provider;

  if existing_secret_id is null then
    select vault.create_secret(
      p_api_key,
      'youragent_' || p_provider || '_' || p_organization_id::text,
      'YOURAGENT runtime credential for organization ' || p_organization_id::text
    ) into next_secret_id;
  else
    perform vault.update_secret(existing_secret_id, p_api_key);
    next_secret_id := existing_secret_id;
  end if;

  insert into public.runtime_connections (
    organization_id,
    provider,
    base_url,
    secret_id,
    external_organization_id,
    status,
    metadata,
    updated_at
  ) values (
    p_organization_id,
    p_provider,
    trim(trailing '/' from p_base_url),
    next_secret_id,
    p_external_organization_id,
    'active',
    coalesce(p_metadata, '{}'::jsonb),
    now()
  )
  on conflict (organization_id, provider) do update set
    base_url = excluded.base_url,
    secret_id = excluded.secret_id,
    external_organization_id = excluded.external_organization_id,
    status = 'active',
    metadata = excluded.metadata,
    updated_at = now();

  return next_secret_id;
end;
$$;

revoke all on function public.upsert_runtime_connection_secret(uuid, text, text, text, text, jsonb) from public;
revoke all on function public.upsert_runtime_connection_secret(uuid, text, text, text, text, jsonb) from anon;
revoke all on function public.upsert_runtime_connection_secret(uuid, text, text, text, text, jsonb) from authenticated;
grant execute on function public.upsert_runtime_connection_secret(uuid, text, text, text, text, jsonb) to service_role;
