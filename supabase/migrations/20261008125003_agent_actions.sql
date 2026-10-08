-- Stage 6: Claude connector writes.
-- 1) Workspace revision: every write must name the revision it was based on, so a
--    stale browser tab cannot silently overwrite a change made through Claude
--    (and vice versa). Clients that omit the column keep working (no conflict check).
alter table public.treasury_workspaces add column if not exists revision bigint not null default 0;
alter table public.earn_smoke_workspaces add column if not exists revision bigint not null default 0;

create or replace function hodd_private.workspace_revision_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.revision is distinct from old.revision then
    raise exception 'workspace revision conflict' using errcode = '40001';
  end if;
  new.revision := old.revision + 1;
  return new;
end;
$$;

drop trigger if exists workspace_revision_guard on public.treasury_workspaces;
create trigger workspace_revision_guard before update on public.treasury_workspaces
  for each row execute function hodd_private.workspace_revision_guard();
drop trigger if exists workspace_revision_guard on public.earn_smoke_workspaces;
create trigger workspace_revision_guard before update on public.earn_smoke_workspaces
  for each row execute function hodd_private.workspace_revision_guard();

-- 2) Audit and money requests made through Claude. Only OAuth (connector) tokens
--    carry a client_id claim, so browser sessions can read but never insert.
create table if not exists public.agent_actions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('TREASURY','SMOKE_TEST')),
  client_id text not null check (length(client_id) between 1 and 200),
  kind text not null check (kind in ('CREATE_OBLIGATION','UPDATE_OBLIGATION','UPDATE_POLICY','SET_TARGETS','PAYMENT_REQUEST','EARN_REQUEST')),
  change jsonb not null,
  summary text not null check (length(summary) between 1 and 500),
  status text not null check (status in ('APPLIED','OPEN','DONE','DISMISSED')),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  resolved_at timestamptz,
  check ((kind in ('PAYMENT_REQUEST','EARN_REQUEST')) = (status <> 'APPLIED'))
);
create index if not exists agent_actions_user_created on public.agent_actions(user_id, scope, created_at desc);
alter table public.agent_actions enable row level security;
revoke all on public.agent_actions from anon, authenticated;
grant select on public.agent_actions to authenticated;
drop policy if exists agent_actions_owner_read on public.agent_actions;
create policy agent_actions_owner_read on public.agent_actions for select to authenticated using (user_id = (select auth.uid()));

-- Atomic: write the workspace at the expected revision and record the action.
-- Security definer because browsers have no insert grant on agent_actions; it
-- checks the caller itself: only the row owner holding a connector token
-- (client_id claim) may call it. The revision guard and the payment obligation
-- trigger still run on the workspace update. A reused confirmation id violates
-- the agent_actions primary key and rolls the whole call back.
create or replace function public.hodd_apply_agent_action(
  p_id uuid, p_scope text, p_kind text, p_change jsonb, p_summary text, p_status text,
  p_expires_at timestamptz, p_workspace jsonb, p_revision bigint
) returns bigint
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_client text := coalesce(auth.jwt()->>'client_id', ''); v_revision bigint;
begin
  if v_user is null or v_client = '' then raise exception 'connector token required'; end if;
  if p_scope = 'TREASURY' then
    update public.treasury_workspaces set workspace = p_workspace, schema_version = 4, updated_at = now(), revision = p_revision
      where user_id = v_user returning revision into v_revision;
  elsif p_scope = 'SMOKE_TEST' then
    update public.earn_smoke_workspaces set workspace = p_workspace, schema_version = 4, updated_at = now(), revision = p_revision
      where user_id = v_user returning revision into v_revision;
  else raise exception 'invalid scope'; end if;
  if v_revision is null then raise exception 'workspace not found'; end if;
  insert into public.agent_actions(id, user_id, scope, client_id, kind, change, summary, status, expires_at)
    values (p_id, v_user, p_scope, v_client, p_kind, p_change, p_summary, p_status, p_expires_at);
  return v_revision;
end;
$$;

-- Owner (browser or connector) resolves an open money request: DONE or DISMISSED.
create or replace function public.hodd_resolve_agent_request(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('DONE','DISMISSED') then raise exception 'invalid status'; end if;
  update public.agent_actions set status = p_status, resolved_at = now()
    where id = p_id and user_id = auth.uid() and status = 'OPEN' and kind in ('PAYMENT_REQUEST','EARN_REQUEST');
  if not found then raise exception 'request not open'; end if;
end;
$$;

revoke all on function public.hodd_apply_agent_action(uuid, text, text, jsonb, text, text, timestamptz, jsonb, bigint) from public, anon;
grant execute on function public.hodd_apply_agent_action(uuid, text, text, jsonb, text, text, timestamptz, jsonb, bigint) to authenticated;
revoke all on function public.hodd_resolve_agent_request(uuid, text) from public, anon;
grant execute on function public.hodd_resolve_agent_request(uuid, text) to authenticated;
