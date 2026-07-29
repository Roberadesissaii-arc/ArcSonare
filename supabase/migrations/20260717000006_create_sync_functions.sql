-- Sync RPCs and Realtime publication for change notifications.

create or replace function public.apply_task_update(
  p_id uuid,
  p_base_version bigint,
  p_patch jsonb,
  p_device_id uuid default null
)
returns public.tasks
language plpgsql
security invoker
set search_path = public
as $$
declare
  row public.tasks;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  update public.tasks t
  set
    title = coalesce(p_patch->>'title', t.title),
    description = case when p_patch ? 'description' then p_patch->>'description' else t.description end,
    status = coalesce(p_patch->>'status', t.status),
    priority = coalesce(p_patch->>'priority', t.priority),
    due_at = case when p_patch ? 'due_at' then (p_patch->>'due_at')::timestamptz else t.due_at end,
    assigned_agent_id = case when p_patch ? 'assigned_agent_id' then (p_patch->>'assigned_agent_id')::uuid else t.assigned_agent_id end,
    progress = coalesce((p_patch->>'progress')::smallint, t.progress),
    tags = case when p_patch ? 'tags' then array(select jsonb_array_elements_text(p_patch->'tags')) else t.tags end,
    configuration = case when p_patch ? 'configuration' then p_patch->'configuration' else t.configuration end,
    completed_at = case when p_patch ? 'completed_at' then (p_patch->>'completed_at')::timestamptz else t.completed_at end,
    deleted_at = case when p_patch ? 'deleted_at' then (p_patch->>'deleted_at')::timestamptz else t.deleted_at end,
    version = t.version + 1,
    updated_by_device_id = p_device_id
  where t.id = p_id
    and t.user_id = auth.uid()
    and t.version = p_base_version
  returning * into row;

  if row.id is null then
    raise exception 'conflict' using errcode = 'P0001';
  end if;
  return row;
end;
$$;

revoke all on function public.apply_task_update(uuid, bigint, jsonb, uuid) from public;
grant execute on function public.apply_task_update(uuid, bigint, jsonb, uuid) to authenticated;

create or replace function public.list_sync_changes(
  p_after_sequence bigint default 0,
  p_limit integer default 200
)
returns setof public.sync_change_log
language sql
stable
security invoker
set search_path = public
as $$
  select *
  from public.sync_change_log
  where user_id = auth.uid()
    and sequence_id > p_after_sequence
  order by sequence_id
  limit least(greatest(p_limit, 1), 500);
$$;

revoke all on function public.list_sync_changes(bigint, integer) from public;
grant execute on function public.list_sync_changes(bigint, integer) to authenticated;

create or replace function public.register_device(
  p_id uuid,
  p_device_name text,
  p_platform text,
  p_platform_version text default null,
  p_architecture text default null,
  p_app_version text default null,
  p_fingerprint_hash text default null
)
returns public.devices
language plpgsql
security invoker
set search_path = public
as $$
declare
  row public.devices;
begin
  if auth.uid() is null then
    raise exception 'not authenticated';
  end if;

  insert into public.devices as d (
    id, user_id, device_name, platform, platform_version, architecture, app_version, device_fingerprint_hash, last_seen_at
  ) values (
    p_id, auth.uid(), p_device_name, p_platform, p_platform_version, p_architecture, p_app_version, p_fingerprint_hash, now()
  )
  on conflict (id) do update set
    device_name = excluded.device_name,
    platform = excluded.platform,
    platform_version = excluded.platform_version,
    architecture = excluded.architecture,
    app_version = excluded.app_version,
    device_fingerprint_hash = coalesce(excluded.device_fingerprint_hash, d.device_fingerprint_hash),
    last_seen_at = now(),
    revoked_at = null
  where d.user_id = auth.uid()
  returning * into row;

  if row.id is null then
    raise exception 'device ownership conflict';
  end if;
  return row;
end;
$$;

revoke all on function public.register_device(uuid, text, text, text, text, text, text) from public;
grant execute on function public.register_device(uuid, text, text, text, text, text, text) to authenticated;

create or replace function public.revoke_device(p_id uuid)
returns public.devices
language plpgsql
security invoker
set search_path = public
as $$
declare
  row public.devices;
begin
  update public.devices
  set revoked_at = now()
  where id = p_id and user_id = auth.uid()
  returning * into row;
  if row.id is null then
    raise exception 'device not found';
  end if;
  return row;
end;
$$;

revoke all on function public.revoke_device(uuid) from public;
grant execute on function public.revoke_device(uuid) to authenticated;

alter publication supabase_realtime add table public.sync_change_log;
