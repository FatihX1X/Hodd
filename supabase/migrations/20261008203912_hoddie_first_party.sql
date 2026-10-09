-- Hoddie uses normal signed-in sessions, never a fabricated connector identity.
-- Filename matches the version recorded by Supabase apply_migration.
alter table public.agent_actions add column if not exists source text not null default 'CLAUDE_MCP'
  check (source in ('CLAUDE_MCP','HODDIE'));

create table if not exists hodd_private.hoddie_usage (
  key text not null, bucket timestamptz not null, used integer not null check (used between 1 and 45),
  primary key (key, bucket)
);
alter table hodd_private.hoddie_usage enable row level security;
create index if not exists hoddie_usage_bucket_idx on hodd_private.hoddie_usage(bucket);
revoke all on hodd_private.hoddie_usage from public, anon, authenticated;

create or replace function public.hoddie_reserve_usage(p_provider text, p_model_call boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_count integer; v_minute timestamptz := date_trunc('minute', now());
begin
  if v_user is null or coalesce(auth.jwt()->>'client_id','') <> '' or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    or not public.hodd_earn_session_active() then raise exception 'active first-party session required'; end if;
  if p_provider not in ('GEMINI','OPENROUTER') then raise exception 'invalid provider'; end if;
  -- The global day is UTC. Upsert/row locks reserve capacity atomically, across hosts.
  if p_model_call and p_provider = 'OPENROUTER' then
    insert into hodd_private.hoddie_usage(key,bucket,used) values ('openrouter:global', date_trunc('day', now() at time zone 'UTC') at time zone 'UTC', 1)
      on conflict(key,bucket) do update set used = hodd_private.hoddie_usage.used + 1 where hodd_private.hoddie_usage.used < 45
      returning used into v_count;
    if v_count is null then raise exception 'daily model budget exceeded'; end if;
  end if;
  v_count := null;
  insert into hodd_private.hoddie_usage(key,bucket,used) values ('user:' || v_user::text, v_minute, 1)
    on conflict(key,bucket) do update set used = hodd_private.hoddie_usage.used + 1 where hodd_private.hoddie_usage.used < 10
    returning used into v_count;
  if v_count is null then raise exception 'minute request budget exceeded'; end if;
  -- Content-free counters only; bound storage growth without a paid scheduler.
  delete from hodd_private.hoddie_usage where bucket < now() - interval '2 days';
end;
$$;

create or replace function public.hodd_apply_hoddie_action(
  p_id uuid, p_kind text, p_change jsonb, p_summary text, p_status text,
  p_expires_at timestamptz, p_workspace jsonb, p_revision bigint
) returns bigint language plpgsql security definer set search_path = '' as $$
declare v_user uuid := auth.uid(); v_revision bigint;
begin
  if v_user is null or coalesce(auth.jwt()->>'client_id','') <> '' or coalesce((auth.jwt()->>'is_anonymous')::boolean,false)
    or not public.hodd_earn_session_active() then raise exception 'active first-party session required'; end if;
  -- Existing payment guards and revision trigger still execute. Duplicate ids roll back the update.
  update public.treasury_workspaces set workspace = p_workspace, schema_version = 4, updated_at = now(), revision = p_revision
    where user_id = v_user returning revision into v_revision;
  if v_revision is null then raise exception 'workspace not found'; end if;
  insert into public.agent_actions(id,user_id,scope,client_id,kind,change,summary,status,expires_at,source)
    values (p_id,v_user,'TREASURY','hoddie:first-party',p_kind,p_change,p_summary,p_status,p_expires_at,'HODDIE');
  return v_revision;
end;
$$;
revoke all on function public.hoddie_reserve_usage(text,boolean) from public, anon;
grant execute on function public.hoddie_reserve_usage(text,boolean) to authenticated;
revoke all on function public.hodd_apply_hoddie_action(uuid,text,jsonb,text,text,timestamptz,jsonb,bigint) from public, anon;
grant execute on function public.hodd_apply_hoddie_action(uuid,text,jsonb,text,text,timestamptz,jsonb,bigint) to authenticated;
