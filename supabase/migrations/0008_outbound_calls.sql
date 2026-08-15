alter table runtime_deployments add column if not exists external_workflow_uuid text;

create index if not exists runtime_deployments_workflow_uuid_idx
  on runtime_deployments(organization_id, external_workflow_uuid)
  where external_workflow_uuid is not null;
