create table public.agents (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  name text not null,
  role text not null,
  description text,
  instructions text,
  status text not null default 'inactive'
    check (status in ('inactive', 'active', 'paused', 'not_configured')),
  runtime_type text not null default 'manual',
  model_provider text,
  model_id text,
  voice_character_id text,
  configuration jsonb not null default '{}'::jsonb,
  approval_policy_id uuid,
  version bigint not null default 1,
  sync_revision bigint not null default nextval('public.arcsonare_sync_revision_seq'),
  updated_by_device_id uuid references public.devices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index agents_user_id_idx on public.agents(user_id);
create index agents_workspace_id_idx on public.agents(workspace_id);
create index agents_sync_revision_idx on public.agents(user_id, sync_revision);
create index agents_active_idx
  on public.agents(user_id, workspace_id, deleted_at)
  where deleted_at is null;

create trigger agents_sync
before update on public.agents
for each row execute function private.set_updated_at_and_sync_revision();

alter table public.tasks
  add constraint tasks_assigned_agent_fk
  foreign key (assigned_agent_id) references public.agents(id) on delete set null;

create table public.agent_tools (
  id uuid primary key,
  agent_id uuid not null references public.agents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  tool_id text not null,
  enabled boolean not null default true,
  permission_level text not null default 'ask'
    check (permission_level in ('deny', 'ask', 'read-only', 'allow')),
  configuration jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  sync_revision bigint not null default nextval('public.arcsonare_sync_revision_seq'),
  updated_by_device_id uuid references public.devices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  unique (agent_id, tool_id)
);

create index agent_tools_user_sync_idx on public.agent_tools(user_id, sync_revision);

create trigger agent_tools_sync
before update on public.agent_tools
for each row execute function private.set_updated_at_and_sync_revision();

create table public.agent_knowledge_sources (
  id uuid primary key,
  agent_id uuid not null references public.agents(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  source_type text not null,
  label text not null,
  configuration jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  sync_revision bigint not null default nextval('public.arcsonare_sync_revision_seq'),
  updated_by_device_id uuid references public.devices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger agent_knowledge_sources_sync
before update on public.agent_knowledge_sources
for each row execute function private.set_updated_at_and_sync_revision();

