-- Synchronized entity tables (metadata only for integrations; no secrets).

create table public.settings_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete cascade,
  device_id uuid references public.devices(id) on delete cascade,
  scope text not null check (scope in ('account', 'workspace', 'device')),
  section text not null,
  document jsonb not null default '{}'::jsonb,
  schema_version integer not null default 1,
  version bigint not null default 1,
  sync_revision bigint not null default nextval('public.arcsonare_sync_revision_seq'),
  updated_by_device_id uuid references public.devices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index settings_account_unique_idx
  on public.settings_documents (user_id, scope, section)
  where device_id is null;

create unique index settings_device_unique_idx
  on public.settings_documents (user_id, scope, section, device_id)
  where device_id is not null;

create index settings_lookup_idx
  on public.settings_documents(user_id, scope, section, device_id);
create index settings_sync_revision_idx
  on public.settings_documents(user_id, sync_revision);

create trigger settings_documents_sync
before update on public.settings_documents
for each row execute function private.set_updated_at_and_sync_revision();

create table public.tasks (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null check (char_length(trim(title)) > 0),
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'completed', 'cancelled')),
  priority text not null default 'none'
    check (priority in ('none', 'low', 'medium', 'high', 'urgent')),
  due_at timestamptz,
  assigned_agent_id uuid,
  progress smallint not null default 0 check (progress between 0 and 100),
  source text not null default 'user',
  tags text[] not null default '{}',
  configuration jsonb not null default '{}'::jsonb,
  version bigint not null default 1,
  sync_revision bigint not null default nextval('public.arcsonare_sync_revision_seq'),
  updated_by_device_id uuid references public.devices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  deleted_at timestamptz
);

create index tasks_user_id_idx on public.tasks(user_id);
create index tasks_workspace_id_idx on public.tasks(workspace_id);
create index tasks_sync_revision_idx on public.tasks(user_id, sync_revision);
create index tasks_active_idx
  on public.tasks(user_id, workspace_id, deleted_at)
  where deleted_at is null;

create trigger tasks_sync
before update on public.tasks
for each row execute function private.set_updated_at_and_sync_revision();

create table public.task_subtasks (
  id uuid primary key,
  task_id uuid not null references public.tasks(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  title text not null,
  completed boolean not null default false,
  sort_order integer not null default 0,
  version bigint not null default 1,
  sync_revision bigint not null default nextval('public.arcsonare_sync_revision_seq'),
  updated_by_device_id uuid references public.devices(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index task_subtasks_task_id_idx on public.task_subtasks(task_id);
create index task_subtasks_user_sync_idx on public.task_subtasks(user_id, sync_revision);

create trigger task_subtasks_sync
before update on public.task_subtasks
for each row execute function private.set_updated_at_and_sync_revision();

