-- Sync change log, change triggers, RPCs, Realtime publication.

create table public.sync_change_log (
  sequence_id bigint generated always as identity primary key,
  user_id uuid not null,
  workspace_id uuid,
  entity_type text not null,
  entity_id uuid not null,
  operation text not null check (operation in ('insert', 'update', 'delete')),
  entity_version bigint,
  changed_at timestamptz not null default now(),
  changed_by_device_id uuid
);

create index sync_change_log_user_seq_idx
  on public.sync_change_log(user_id, sequence_id);
create index sync_change_log_entity_idx
  on public.sync_change_log(user_id, entity_type, entity_id);

create or replace function private.log_sync_change_row(
  p_user_id uuid,
  p_workspace_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_operation text,
  p_entity_version bigint,
  p_device_id uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.sync_change_log (
    user_id, workspace_id, entity_type, entity_id, operation, entity_version, changed_by_device_id
  ) values (
    p_user_id, p_workspace_id, p_entity_type, p_entity_id, p_operation, p_entity_version, p_device_id
  );
$$;

create or replace function private.workspace_entity_change_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  etype text := tg_argv[0];
  op text;
begin
  if tg_op = 'INSERT' then
    perform private.log_sync_change_row(new.user_id, new.workspace_id, etype, new.id, 'insert', new.version, new.updated_by_device_id);
    return new;
  elsif tg_op = 'UPDATE' then
    op := case when new.deleted_at is not null and old.deleted_at is null then 'delete' else 'update' end;
    perform private.log_sync_change_row(new.user_id, new.workspace_id, etype, new.id, op, new.version, new.updated_by_device_id);
    return new;
  else
    perform private.log_sync_change_row(old.user_id, old.workspace_id, etype, old.id, 'delete', old.version, old.updated_by_device_id);
    return old;
  end if;
end; $$;

create or replace function private.user_entity_change_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  etype text := tg_argv[0];
  op text;
begin
  if tg_op = 'INSERT' then
    perform private.log_sync_change_row(new.user_id, null, etype, new.id, 'insert', new.version, null);
    return new;
  elsif tg_op = 'UPDATE' then
    op := case when new.deleted_at is not null and old.deleted_at is null then 'delete' else 'update' end;
    perform private.log_sync_change_row(new.user_id, null, etype, new.id, op, new.version, null);
    return new;
  else
    perform private.log_sync_change_row(old.user_id, null, etype, old.id, 'delete', old.version, null);
    return old;
  end if;
end; $$;

create or replace function private.settings_change_log()
returns trigger language plpgsql security definer set search_path = '' as $$
declare op text;
begin
  if tg_op = 'INSERT' then
    perform private.log_sync_change_row(new.user_id, new.workspace_id, 'settings_documents', new.id, 'insert', new.version, new.updated_by_device_id);
    return new;
  elsif tg_op = 'UPDATE' then
    op := case when new.deleted_at is not null and old.deleted_at is null then 'delete' else 'update' end;
    perform private.log_sync_change_row(new.user_id, new.workspace_id, 'settings_documents', new.id, op, new.version, new.updated_by_device_id);
    return new;
  else
    perform private.log_sync_change_row(old.user_id, old.workspace_id, 'settings_documents', old.id, 'delete', old.version, old.updated_by_device_id);
    return old;
  end if;
end; $$;

create or replace function private.activity_events_change_log()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.log_sync_change_row(new.user_id, new.workspace_id, 'activity_events', new.id, 'insert', null, new.device_id);
    return new;
  elsif tg_op = 'UPDATE' then
    perform private.log_sync_change_row(new.user_id, new.workspace_id, 'activity_events', new.id, 'update', null, new.device_id);
    return new;
  else
    perform private.log_sync_change_row(old.user_id, old.workspace_id, 'activity_events', old.id, 'delete', null, old.device_id);
    return old;
  end if;
end; $$;

create trigger tasks_change_log after insert or update or delete on public.tasks
for each row execute function private.workspace_entity_change_log('tasks');
create trigger agents_change_log after insert or update or delete on public.agents
for each row execute function private.workspace_entity_change_log('agents');
create trigger task_subtasks_change_log after insert or update or delete on public.task_subtasks
for each row execute function private.workspace_entity_change_log('task_subtasks');
create trigger agent_tools_change_log after insert or update or delete on public.agent_tools
for each row execute function private.workspace_entity_change_log('agent_tools');
create trigger agent_knowledge_sources_change_log after insert or update or delete on public.agent_knowledge_sources
for each row execute function private.workspace_entity_change_log('agent_knowledge_sources');
create trigger approvals_change_log after insert or update or delete on public.approvals
for each row execute function private.workspace_entity_change_log('approvals');
create trigger approval_policies_change_log after insert or update or delete on public.approval_policies
for each row execute function private.workspace_entity_change_log('approval_policies');
create trigger settings_documents_change_log after insert or update or delete on public.settings_documents
for each row execute function private.settings_change_log();
create trigger application_aliases_change_log after insert or update or delete on public.application_aliases
for each row execute function private.user_entity_change_log('application_aliases');
create trigger service_preferences_change_log after insert or update or delete on public.service_preferences
for each row execute function private.user_entity_change_log('service_preferences');
create trigger integration_accounts_change_log after insert or update or delete on public.integration_accounts
for each row execute function private.user_entity_change_log('integration_accounts');
create trigger activity_events_change_log after insert or update or delete on public.activity_events
for each row execute function private.activity_events_change_log();
