-- Tasks
create policy "Users read own tasks"
on public.tasks for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users insert own tasks"
on public.tasks for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users update own tasks"
on public.tasks for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users delete own tasks"
on public.tasks for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

-- Task subtasks
create policy "Users read own subtasks"
on public.task_subtasks for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users insert own subtasks"
on public.task_subtasks for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users update own subtasks"
on public.task_subtasks for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users delete own subtasks"
on public.task_subtasks for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

-- Agents
create policy "Users read own agents"
on public.agents for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users insert own agents"
on public.agents for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users update own agents"
on public.agents for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users delete own agents"
on public.agents for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

-- Agent tools
create policy "Users read own agent tools"
on public.agent_tools for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users insert own agent tools"
on public.agent_tools for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users update own agent tools"
on public.agent_tools for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users delete own agent tools"
on public.agent_tools for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

-- Agent knowledge
create policy "Users read own knowledge sources"
on public.agent_knowledge_sources for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users insert own knowledge sources"
on public.agent_knowledge_sources for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users update own knowledge sources"
on public.agent_knowledge_sources for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users delete own knowledge sources"
on public.agent_knowledge_sources for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

-- Integrations (metadata only)
create policy "Users read own integrations"
on public.integration_accounts for select to authenticated
using (user_id = (select auth.uid()));

create policy "Users insert own integrations"
on public.integration_accounts for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Users update own integrations"
on public.integration_accounts for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users delete own integrations"
on public.integration_accounts for delete to authenticated
using (user_id = (select auth.uid()));

create policy "Users read own integration services"
on public.integration_services for select to authenticated
using (user_id = (select auth.uid()));

create policy "Users insert own integration services"
on public.integration_services for insert to authenticated
with check (user_id = (select auth.uid()));

create policy "Users update own integration services"
on public.integration_services for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users delete own integration services"
on public.integration_services for delete to authenticated
using (user_id = (select auth.uid()));

-- Service preferences / aliases
create policy "Users manage own service preferences"
on public.service_preferences for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy "Users manage own application aliases"
on public.application_aliases for all to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

-- Approvals
create policy "Users read own approval policies"
on public.approval_policies for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users insert own approval policies"
on public.approval_policies for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users update own approval policies"
on public.approval_policies for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users delete own approval policies"
on public.approval_policies for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users read own approvals"
on public.approvals for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users insert own approvals"
on public.approvals for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users update own approvals"
on public.approvals for update to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users delete own approvals"
on public.approvals for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

-- Activity
create policy "Users read own activity"
on public.activity_events for select to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users insert own activity"
on public.activity_events for insert to authenticated
with check (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

create policy "Users delete own activity"
on public.activity_events for delete to authenticated
using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

-- Change log: read-only for owners; writes only via security definer triggers
create policy "Users read own change log"
on public.sync_change_log for select to authenticated
using (user_id = (select auth.uid()));

-- Entitlements
create policy "Users read own entitlements"
on public.subscription_entitlements for select to authenticated
using (user_id = (select auth.uid()));
