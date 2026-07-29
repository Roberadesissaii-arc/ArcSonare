-- Row Level Security for all exposed ArcSonare tables.

alter table public.profiles enable row level security;
alter table public.devices enable row level security;
alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.settings_documents enable row level security;
alter table public.tasks enable row level security;
alter table public.task_subtasks enable row level security;
alter table public.agents enable row level security;
alter table public.agent_tools enable row level security;
alter table public.agent_knowledge_sources enable row level security;
alter table public.integration_accounts enable row level security;
alter table public.integration_services enable row level security;
alter table public.service_preferences enable row level security;
alter table public.application_aliases enable row level security;
alter table public.approval_policies enable row level security;
alter table public.approvals enable row level security;
alter table public.activity_events enable row level security;
alter table public.sync_change_log enable row level security;
alter table public.subscription_entitlements enable row level security;

-- Profiles
create policy "Users can read own profile"
on public.profiles for select to authenticated
using (id = (select auth.uid()));

create policy "Users can insert own profile"
on public.profiles for insert to authenticated
with check (id = (select auth.uid()));

create policy "Users can update own profile"
on public.profiles for update to authenticated
using (id = (select auth.uid()))
with check (id = (select auth.uid()));

-- Devices
create policy "Users can read own devices"
on public.devices for select to authenticated
using (user_id = (select auth.uid()));

create policy "Users can insert own devices"
on public.devices for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Users can update own devices"
on public.devices for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users can delete own devices"
on public.devices for delete to authenticated
using (user_id = (select auth.uid()));

-- Workspaces
create policy "Members can read workspaces"
on public.workspaces for select to authenticated
using (private.is_workspace_member(id) or owner_user_id = (select auth.uid()));

create policy "Owners can insert workspaces"
on public.workspaces for insert to authenticated
with check (owner_user_id = (select auth.uid()));

create policy "Owners can update workspaces"
on public.workspaces for update to authenticated
using (owner_user_id = (select auth.uid()))
with check (owner_user_id = (select auth.uid()));

-- Workspace members
create policy "Members can read membership"
on public.workspace_members for select to authenticated
using (
  user_id = (select auth.uid())
  or private.is_workspace_member(workspace_id)
);

create policy "Owners can insert membership"
on public.workspace_members for insert to authenticated
with check (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_user_id = (select auth.uid())
  )
  or user_id = (select auth.uid())
);

create policy "Owners can update membership"
on public.workspace_members for update to authenticated
using (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_user_id = (select auth.uid())
  )
)
with check (
  exists (
    select 1 from public.workspaces w
    where w.id = workspace_id and w.owner_user_id = (select auth.uid())
  )
);

-- Helper macro pattern for user-owned + workspace tables
create policy "Users read own settings"
on public.settings_documents for select to authenticated
using (user_id = (select auth.uid()));

create policy "Users insert own settings"
on public.settings_documents for insert to authenticated
with check (
  user_id = (select auth.uid())
  and (workspace_id is null or private.is_workspace_member(workspace_id))
);

create policy "Users update own settings"
on public.settings_documents for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users delete own settings"
on public.settings_documents for delete to authenticated
using (user_id = (select auth.uid()));

