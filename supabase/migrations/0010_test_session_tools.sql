alter table runtime_test_sessions add column if not exists metadata jsonb not null default '{}'::jsonb;
