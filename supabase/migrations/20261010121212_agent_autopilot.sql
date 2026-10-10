-- Server-written Autopilot ledger: developer-controlled agent wallets, mandates, runs and steps.
create table public.agent_wallets (
  user_id uuid primary key references auth.users(id) on delete restrict,
  circle_wallet_id uuid not null unique, wallet_set_id uuid not null,
  address text not null unique check (address ~ '^0x[0-9a-f]{40}$'),
  owner_address text not null check (owner_address ~ '^0x[0-9a-f]{40}$'),
  account_type text not null check (account_type in ('EOA','SCA')),
  created_at timestamptz not null default now()
);
create table public.agent_mandates (
  user_id uuid primary key references public.agent_wallets(user_id) on delete restrict,
  mandate jsonb not null, revision bigint not null default 1,
  spent_minor numeric(30,0) not null default 0 check (spent_minor >= 0),
  return_requested boolean not null default false,
  updated_at timestamptz not null default now(),
  check ((mandate->>'budgetMinor')::numeric between 1 and 1000000000),
  check ((mandate->>'maxPerRunMinor')::numeric between 1 and (mandate->>'budgetMinor')::numeric),
  check ((mandate->>'reserveMinor')::numeric between 0 and (mandate->>'budgetMinor')::numeric),
  check ((mandate->>'maxMorphoBps')::integer between 0 and 10000)
);
create table public.agent_runs (
  id uuid primary key, user_id uuid not null references public.agent_wallets(user_id) on delete restrict,
  state text not null check (state in ('RUNNING','NO_ACTION','COMPLETED','PARTIAL','FAILED','UNKNOWN')),
  snapshot jsonb not null, decision jsonb not null, quote jsonb,
  return_all boolean not null default false,
  processing_until timestamptz, processing_token uuid,
  failure text, created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,user_id)
);
create unique index agent_one_open_run on public.agent_runs(user_id) where state in ('RUNNING','UNKNOWN');
create index agent_run_history on public.agent_runs(user_id,created_at desc);
create table public.agent_run_steps (
  id uuid primary key, run_id uuid not null, user_id uuid not null,
  state text not null check (state in ('PREPARED','SUBMITTING','SUBMITTED','VERIFIED','FAILED','UNKNOWN')),
  stage text not null check (stage in ('APPROVAL','EARN','TRANSFER')),
  call jsonb not null, gas_limit text not null check (gas_limit ~ '^[0-9]+$'), gas_price_wei text not null check (gas_price_wei ~ '^[0-9]+$'),
  started_block text not null check (started_block ~ '^[0-9]+$'),
  amount_minor numeric(30,0) not null check (amount_minor >= 0),
  circle_transaction_id uuid unique, tx_hash text unique check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  receipt jsonb, created_at timestamptz not null default now(),
  foreign key(run_id,user_id) references public.agent_runs(id,user_id) on delete restrict
);
create unique index agent_one_unresolved_step on public.agent_run_steps(run_id) where state in ('PREPARED','SUBMITTING','SUBMITTED','UNKNOWN');
create table hodd_private.agent_reviews (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete restrict,
  session_id text not null, workspace_revision bigint not null, mandate_revision bigint not null,
  owner_address text not null, mandate jsonb not null, kind text not null check (kind in ('MANDATE','RETURN_ALL')),
  expires_at timestamptz not null, consumed_at timestamptz
);
alter table hodd_private.agent_reviews enable row level security;
revoke all on hodd_private.agent_reviews from public,anon,authenticated;
-- PostgREST exposes server-only review RPCs, never the private table.
create function public.hodd_agent_review(p_id uuid,p_user uuid,p_session text,p_workspace_revision bigint,p_mandate_revision bigint,p_owner text,p_mandate jsonb,p_kind text) returns void
language sql security invoker set search_path='' as $$
  insert into hodd_private.agent_reviews(id,user_id,session_id,workspace_revision,mandate_revision,owner_address,mandate,kind,expires_at)
  values(p_id,p_user,p_session,p_workspace_revision,p_mandate_revision,p_owner,p_mandate,p_kind,now()+interval '10 minutes');
$$;
create function public.hodd_confirm_agent_review(p_id uuid,p_user uuid,p_session text,p_kind text) returns text
language plpgsql security invoker set search_path='' as $$
declare r hodd_private.agent_reviews; w public.treasury_workspaces; m public.agent_mandates; owner text;
begin
  select * into w from public.treasury_workspaces where user_id=p_user for update;
  select * into m from public.agent_mandates where user_id=p_user for update;
  select owner_address into owner from public.agent_wallets where user_id=p_user;
  update hodd_private.agent_reviews set consumed_at=now() where id=p_id and user_id=p_user and session_id=p_session and consumed_at is null and expires_at>now() returning * into r;
  if not found or r.kind is distinct from p_kind or w.revision is distinct from r.workspace_revision or coalesce(m.revision,0)<>r.mandate_revision or owner is distinct from r.owner_address or lower(w.workspace->'walletConnection'->>'address') is distinct from owner then raise exception 'agent review changed'; end if;
  if exists(select 1 from public.agent_runs where user_id=p_user and state in ('RUNNING','UNKNOWN')) then raise exception 'agent run unresolved'; end if;
  if (r.mandate->>'maxMorphoBps')::integer > (w.workspace->'policy'->'strategyCapsBps'->>'MORPHO')::integer
    or ((r.mandate->>'maxMorphoBps')::integer>0 and not (w.workspace->'policy'->'enabledStrategies'->>'MORPHO')::boolean)
    or (r.mandate->>'budgetMinor')::numeric < coalesce(m.spent_minor,0) then raise exception 'agent mandate exceeds policy'; end if;
  insert into public.agent_mandates(user_id,mandate,return_requested) values(p_user,r.mandate,r.kind='RETURN_ALL')
  on conflict(user_id) do update set mandate=excluded.mandate,revision=public.agent_mandates.revision+1,return_requested=excluded.return_requested,updated_at=now();
  return r.kind;
end; $$;
create function public.hodd_pause_agent(p_user uuid) returns void
language sql security invoker set search_path='' as $$
  update public.agent_mandates set mandate=jsonb_set(mandate,'{paused}','true'),return_requested=false,revision=revision+1,updated_at=now() where user_id=p_user;
$$;
create table hodd_private.agent_usage (day date primary key, runs integer not null check (runs between 1 and 50));
alter table hodd_private.agent_usage enable row level security;
revoke all on hodd_private.agent_usage from public,anon,authenticated;
create function public.hodd_start_agent_run(p_id uuid,p_user uuid,p_snapshot jsonb,p_decision jsonb,p_quote jsonb,p_return_all boolean,p_revision bigint) returns void
language plpgsql security invoker set search_path='' as $$
declare m public.agent_mandates; n integer;
begin
  select * into m from public.agent_mandates where user_id=p_user for update;
  if not found or m.revision<>p_revision or m.return_requested is distinct from p_return_all then raise exception 'agent mandate changed'; end if;
  if exists(select 1 from public.agent_runs where user_id=p_user and created_at>now()-interval '5 minutes') then raise exception 'agent rate limit'; end if;
  if exists(select 1 from public.agent_runs where user_id=p_user and state in ('RUNNING','UNKNOWN')) then raise exception 'agent run unresolved'; end if;
  insert into hodd_private.agent_usage(day,runs) values ((now() at time zone 'UTC')::date,1)
    on conflict(day) do update set runs=hodd_private.agent_usage.runs+1 where hodd_private.agent_usage.runs<50 returning runs into n;
  if n is null then raise exception 'agent global rate limit'; end if;
  insert into public.agent_runs(id,user_id,state,snapshot,decision,quote,return_all)
  values(p_id,p_user,case when p_decision->>'kind'='NO_ACTION' then 'NO_ACTION' else 'RUNNING' end,p_snapshot,p_decision,p_quote,p_return_all);
  update public.agent_mandates set updated_at=now() where user_id=p_user;
  delete from hodd_private.agent_usage where day < (now() at time zone 'UTC')::date-2;
end; $$;
create function public.hodd_claim_agent_run(p_id uuid,p_token uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
  update public.agent_runs set processing_token=p_token,processing_until=now()+interval '60 seconds' where id=p_id and state in ('RUNNING','UNKNOWN') and (processing_until is null or processing_until<now());
  return found;
end; $$;
create function hodd_private.account_agent_step() returns trigger
language plpgsql security invoker set search_path='' as $$
declare cost numeric; m public.agent_mandates;
begin
  if new.state='VERIFIED' and old.state is distinct from 'VERIFIED' then
    if new.receipt is null or new.tx_hash is null then raise exception 'agent receipt required'; end if;
    cost := (new.receipt->>'feeMinor')::numeric + case when new.stage='TRANSFER' and new.receipt->>'status'='VERIFIED' then new.amount_minor else 0 end;
    if cost is null or cost<0 then raise exception 'agent fee required'; end if;
    select * into m from public.agent_mandates where user_id=new.user_id for update;
    -- Budget overruns keep evidence and disable further activity, rather than losing proof.
    update public.agent_mandates set spent_minor=spent_minor+cost,
      mandate=case when spent_minor+cost >= (mandate->>'budgetMinor')::numeric then jsonb_set(mandate,'{paused}','true') else mandate end,
      updated_at=now() where user_id=new.user_id;
  end if;
  return new;
end; $$;
create trigger account_agent_step after update of state on public.agent_run_steps for each row execute function hodd_private.account_agent_step();
-- No automatic account deletion may erase recoverable custody records.
alter table public.agent_wallets enable row level security;
alter table public.agent_mandates enable row level security;
alter table public.agent_runs enable row level security;
alter table public.agent_run_steps enable row level security;
create policy agent_wallet_owner on public.agent_wallets for select to authenticated using((select auth.uid())=user_id);
create policy agent_mandate_owner on public.agent_mandates for select to authenticated using((select auth.uid())=user_id);
create policy agent_run_owner on public.agent_runs for select to authenticated using((select auth.uid())=user_id);
create policy agent_step_owner on public.agent_run_steps for select to authenticated using((select auth.uid())=user_id);
revoke all on public.agent_wallets,public.agent_mandates,public.agent_runs,public.agent_run_steps from public,anon,authenticated;
grant select on public.agent_wallets,public.agent_mandates,public.agent_runs,public.agent_run_steps to authenticated;
grant all on public.agent_wallets,public.agent_mandates,public.agent_runs,public.agent_run_steps,hodd_private.agent_reviews,hodd_private.agent_usage to service_role;
grant usage on schema hodd_private to service_role;
revoke all on function public.hodd_agent_review(uuid,uuid,text,bigint,bigint,text,jsonb,text),public.hodd_confirm_agent_review(uuid,uuid,text,text),public.hodd_pause_agent(uuid),public.hodd_start_agent_run(uuid,uuid,jsonb,jsonb,jsonb,boolean,bigint),public.hodd_claim_agent_run(uuid,uuid),hodd_private.account_agent_step() from public,anon,authenticated;
grant execute on function public.hodd_agent_review(uuid,uuid,text,bigint,bigint,text,jsonb,text),public.hodd_confirm_agent_review(uuid,uuid,text,text),public.hodd_pause_agent(uuid),public.hodd_start_agent_run(uuid,uuid,jsonb,jsonb,jsonb,boolean,bigint),public.hodd_claim_agent_run(uuid,uuid) to service_role;
insert into public.hodd_live_controls(key,enabled,reason) values('AGENT',false,'Off until developer-wallet smoke evidence and owner review.') on conflict(key) do nothing;
