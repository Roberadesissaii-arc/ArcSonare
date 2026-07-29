create table public.integration_accounts (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null,
  account_label text,
  account_email text,
  status text not null
    check (status in ('disconnected', 'connected', 'expired', 'error', 'reconnect_required')),
  services text[] not null default '{}',
  granted_scopes text[] not null default '{}',
  token_storage_mode text not null default 'none'
    check (token_storage_mode in ('none', 'device', 'server')),
  server_connection_id text,
  last_validated_at timestamptz,
  last_successful_request_at timestamptz,
  reconnect_required boolean not null default false,
  version bigint not null default 1,
  sync_revision bigint not null default nextval('public.arcsonare_sync_revision_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index integration_accounts_user_idx on public.integration_accounts(user_id);
create index integration_accounts_sync_idx
  on public.integration_accounts(user_id, sync_revision);

create trigger integration_accounts_sync
before update on public.integration_accounts
for each row execute function private.set_updated_at_and_sync_revision();

create table public.integration_services (
  id uuid primary key default gen_random_uuid(),
  integration_account_id uuid not null
    references public.integration_accounts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  service_id text not null,
  enabled boolean not null default true,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (integration_account_id, service_id)
);

create trigger integration_services_updated
before update on public.integration_services
for each row execute function private.set_updated_at();

create table public.service_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  service_id text not null,
  preferred_target text not null default 'native'
    check (preferred_target in ('native', 'web')),
  preferred_browser text,
  confirmed boolean not null default false,
  last_used_at timestamptz,
  version bigint not null default 1,
  sync_revision bigint not null default nextval('public.arcsonare_sync_revision_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, service_id)
);

create trigger service_preferences_sync
before update on public.service_preferences
for each row execute function private.set_updated_at_and_sync_revision();

create table public.application_aliases (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  phrase text not null,
  canonical_service_id text not null,
  preferred_target text not null default 'native'
    check (preferred_target in ('native', 'web')),
  preferred_browser text,
  confirmed_by_user boolean not null default false,
  last_used_at timestamptz,
  version bigint not null default 1,
  sync_revision bigint not null default nextval('public.arcsonare_sync_revision_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (user_id, phrase)
);

create trigger application_aliases_sync
before update on public.application_aliases
for each row execute function private.set_updated_at_and_sync_revision();

create table public.approval_policies (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  document jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  sync_revision bigint not null default nextval('public.arcsonare_sync_revision_seq'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger approval_policies_sync
before update on public.approval_policies
for each row execute function private.set_updated_at_and_sync_revision();

create table public.approvals (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete set null,
  task_id uuid references public.tasks(id) on delete set null,
  action_type text not null,
  title text not null,
  summary text,
  priority text not null default 'medium'
    check (priority in ('low', 'medium', 'high', 'urgent')),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired', 'executed', 'failed')),
  requested_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by_user_id uuid references auth.users(id) on delete set null,
  expires_at timestamptz,
  version bigint not null default 1,
  sync_revision bigint not null default nextval('public.arcsonare_sync_revision_seq'),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index approvals_user_idx on public.approvals(user_id);
create index approvals_sync_idx on public.approvals(user_id, sync_revision);

create trigger approvals_sync
before update on public.approvals
for each row execute function private.set_updated_at_and_sync_revision();

create table public.activity_events (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  device_id uuid references public.devices(id) on delete set null,
  entity_type text,
  entity_id uuid,
  event_type text not null,
  title text not null,
  summary text,
  status text not null default 'info',
  occurred_at timestamptz not null default now(),
  expires_at timestamptz,
  sync_revision bigint not null default nextval('public.arcsonare_sync_revision_seq')
);

create index activity_events_user_idx on public.activity_events(user_id, occurred_at desc);
create index activity_events_sync_idx on public.activity_events(user_id, sync_revision);

create table public.subscription_entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free',
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  valid_until timestamptz,
  updated_at timestamptz not null default now()
);

create trigger subscription_entitlements_updated
before update on public.subscription_entitlements
for each row execute function private.set_updated_at();
