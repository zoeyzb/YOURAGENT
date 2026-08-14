alter table organizations add column if not exists owner_user_id uuid;

-- Replace the recursive membership read policy with a direct ownership rule.
drop policy if exists "members can read memberships in their org" on organization_members;
create policy "users can read their own memberships" on organization_members
for select to authenticated
using ((select auth.uid()) = user_id);

-- Owners may create their organization row. Membership is added separately.
create policy "authenticated users can create owned organizations" on organizations
for insert to authenticated
with check ((select auth.uid()) = owner_user_id);

create policy "owners can read owned organizations" on organizations
for select to authenticated
using (
  owner_user_id = (select auth.uid())
  or exists (
    select 1 from organization_members m
    where m.organization_id = organizations.id
      and m.user_id = (select auth.uid())
  )
);

create policy "owners can delete owned organizations" on organizations
for delete to authenticated
using (owner_user_id = (select auth.uid()));

create policy "owners can bootstrap their own membership" on organization_members
for insert to authenticated
with check (
  user_id = (select auth.uid())
  and exists (
    select 1 from organizations o
    where o.id = organization_members.organization_id
      and o.owner_user_id = (select auth.uid())
  )
);

create policy "admins can mutate agent versions in their org" on agent_versions
for all to authenticated
using (exists (
  select 1 from organization_members m
  where m.organization_id = agent_versions.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
))
with check (exists (
  select 1 from organization_members m
  where m.organization_id = agent_versions.organization_id
    and m.user_id = (select auth.uid())
    and m.role in ('owner','admin')
));
