-- Auth signup: create profile + personal workspace + owner membership.

create or replace function private.create_initial_user_resources()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  ws_id uuid := gen_random_uuid();
  display text;
begin
  display := coalesce(
    new.raw_user_meta_data->>'display_name',
    new.raw_user_meta_data->>'full_name',
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'ArcSonare User'
  );

  insert into public.profiles (id, display_name)
  values (new.id, display)
  on conflict (id) do nothing;

  insert into public.workspaces (id, owner_user_id, name, type)
  values (ws_id, new.id, 'Personal', 'personal');

  insert into public.workspace_members (workspace_id, user_id, role, status)
  values (ws_id, new.id, 'owner', 'active')
  on conflict (workspace_id, user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function private.create_initial_user_resources();
