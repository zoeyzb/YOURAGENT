alter table runtime_deployments add column if not exists webhook_token_hash text;

create unique index if not exists runtime_deployments_webhook_token_hash_unique
  on runtime_deployments(webhook_token_hash)
  where webhook_token_hash is not null;
