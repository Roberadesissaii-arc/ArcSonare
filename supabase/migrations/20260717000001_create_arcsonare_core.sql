-- ArcSonare core: private helpers, sync revision, profiles, devices, workspaces.

create schema if not exists private;

create sequence if not exists public.arcsonare_sync_revision_seq;

create or replace function private.set_updated_at_and_sync_revision()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.sync_revision := nextval('public.arcsonare_sync_revision_seq');
  return new;
end;
$$;

create or replace function private.set_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  locale text not null default 'en-US',
  timezone text,
  week_starts_on smallint not null default 0
    check (week_starts_on between 0 and 6),
  time_format text not null default 'system'
    check (time_format in ('system', '12h', '24h')),
  onboarding_completed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function private.set_updated_at();

create table public.devices (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  device_name text not null,
  platform text not null,
  platform_version text,
  architecture text,
  app_version text,
  device_fingerprint_hash text,
  last_seen_at timestamptz,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index devices_user_id_idx on public.devices(user_id);
create index devices_user_active_idx on public.devices(user_id)
  where revoked_at is null;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  type text not null default 'personal'
    check (type in ('personal', 'team')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create trigger workspaces_set_updated_at
before update on public.workspaces
for each row execute function private.set_updated_at();

create index workspaces_owner_idx on public.workspaces(owner_user_id);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner'
    check (role in ('owner', 'admin', 'member', 'viewer')),
  status text not null default 'active'
    check (status in ('active', 'invited', 'removed')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create index workspace_members_user_idx on public.workspace_members(user_id);
create index workspace_members_active_idx
  on public.workspace_members(workspace_id, user_id)
  where status = 'active';

-- Created after workspace_members so SQL body validates.
create or replace function private.is_workspace_member(workspace_uuid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.workspace_members wm
    where wm.workspace_id = workspace_uuid
      and wm.user_id = (select auth.uid())
      and wm.status = 'active'
  );
$$;

revoke all on function private.is_workspace_member(uuid) from public;
grant execute on function private.is_workspace_member(uuid) to authenticated;
