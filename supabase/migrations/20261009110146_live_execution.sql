-- Live Arc Testnet execution on serverless hosts. Quotes, Earn executions and
-- the shared per-wallet lease are durable rows instead of process memory and
-- local files. No funds move in SQL: every state write is server-side
-- (service_role) after receipt verification, except the owner-scoped usage
-- reservation, which only counts requests.

create table public.earn_quotes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('TREASURY','SMOKE_TEST')),
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  binding text not null,
  policy_digest text not null,
  quote jsonb not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index earn_quotes_user_created_idx on public.earn_quotes(user_id, created_at desc);

-- Block numbers and wei amounts are exact decimal text (JSON numbers lose precision).
create table public.earn_executions (
  id uuid primary key references public.earn_quotes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('TREASURY','SMOKE_TEST')),
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  wallet jsonb not null,
  binding text not null,
  policy_digest text not null,
  quote jsonb not null,
  state text not null default 'PREPARING' check (state in ('PREPARING','AWAITING_SIGNATURE','SUBMITTED','COMPLETE','PARTIAL','FAILED','UNKNOWN')),
  approvals integer not null default 0 check (approvals between 0 and 2),
  started_block text not null check (started_block ~ '^[0-9]+$'),
  gas_spent_wei text not null default '0' check (gas_spent_wei ~ '^[0-9]+$'),
  pending jsonb,
  events jsonb not null default '[]'::jsonb,
  result jsonb,
  failure jsonb,
  version integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- One unresolved Earn execution per user; UNKNOWN stays until reviewed.
create unique index earn_one_active_user on public.earn_executions(user_id) where state in ('PREPARING','AWAITING_SIGNATURE','SUBMITTED','UNKNOWN');
create index earn_executions_user_created_idx on public.earn_executions(user_id, created_at desc);

-- A verified hash can advance exactly one step of one wallet's execution.
create table public.earn_execution_receipts (
  tx_hash text not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  execution_id uuid not null references public.earn_executions(id) on delete cascade,
  stage text not null check (stage in ('APPROVAL','EARN')),
  created_at timestamptz not null default now(),
  primary key (tx_hash, wallet_address)
);

-- One in-flight Earn or payment execution per wallet, across users and hosts.
create table public.wallet_leases (
  wallet_address text primary key check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check (scope in ('TREASURY','SMOKE_TEST')),
  kind text not null check (kind in ('EARN','PAYMENT')),
  holder_id uuid not null unique,
  state text not null check (state in ('ACTIVE','UNKNOWN')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create function hodd_private.sync_wallet_lease() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_kind text := case when tg_table_name = 'earn_executions' then 'EARN' else 'PAYMENT' end;
begin
  if tg_op = 'UPDATE' and new.state is not distinct from old.state then return new; end if;
  if new.state in ('PREPARING','AWAITING_SIGNATURE','SUBMITTED','UNKNOWN') then
    insert into public.wallet_leases(wallet_address, user_id, scope, kind, holder_id, state)
    values (lower(new.wallet_address), new.user_id, new.scope, v_kind, new.id, case when new.state = 'UNKNOWN' then 'UNKNOWN' else 'ACTIVE' end)
    on conflict (wallet_address) do update set state = excluded.state, updated_at = now()
      where public.wallet_leases.holder_id = excluded.holder_id;
    -- Another execution holds this wallet; the caller's whole transaction rolls back.
    if not found then raise exception 'wallet busy'; end if;
  else
    -- Terminal outcomes release; UNKNOWN above deliberately keeps the lease.
    delete from public.wallet_leases where holder_id = new.id;
  end if;
  return new;
end;
$$;
revoke all on function hodd_private.sync_wallet_lease() from public, anon, authenticated;
create trigger payment_wallet_lease after insert or update of state on public.payment_proposals for each row execute function hodd_private.sync_wallet_lease();
create trigger earn_wallet_lease after insert or update of state on public.earn_executions for each row execute function hodd_private.sync_wallet_lease();

-- Operator controls: an instant kill switch and per-provider switches.
create table public.hodd_live_controls (
  key text primary key check (key ~ '^[A-Z_:]+$'),
  enabled boolean not null,
  reason text,
  updated_at timestamptz not null default now()
);
insert into public.hodd_live_controls(key, enabled, reason) values
  ('EXECUTION', true, 'Live Arc Testnet execution'),
  ('EARN', true, null),
  ('PAYMENTS', true, null),
  ('PROVIDER:INJECTED_METAMASK', true, null),
  ('PROVIDER:INJECTED_RABBY', true, null),
  ('PROVIDER:CIRCLE_MODULAR', true, null),
  ('PROVIDER:CIRCLE_USER_CONTROLLED', false, 'Enabled after the first verified production PIN run.');

-- Public sign-up requires proof that the signed-in user controls the wallet.
create table public.wallet_ownership_proofs (
  user_id uuid not null references auth.users(id) on delete cascade,
  wallet_address text not null check (wallet_address ~ '^0x[0-9a-f]{40}$'),
  provider text not null,
  proof jsonb not null,
  verified_at timestamptz not null default now(),
  primary key (user_id, wallet_address)
);

alter table public.payment_proposals
  add column pending jsonb,
  add column provider_challenge_id text,
  add column release_proof jsonb;

alter table public.earn_quotes enable row level security;
alter table public.earn_executions enable row level security;
alter table public.earn_execution_receipts enable row level security;
alter table public.wallet_leases enable row level security;
alter table public.hodd_live_controls enable row level security;
alter table public.wallet_ownership_proofs enable row level security;
revoke all on public.earn_quotes, public.earn_executions, public.earn_execution_receipts, public.wallet_leases, public.hodd_live_controls, public.wallet_ownership_proofs from public, anon, authenticated;
grant select on public.earn_quotes, public.earn_executions, public.wallet_leases, public.wallet_ownership_proofs to authenticated;
grant select on public.hodd_live_controls to anon, authenticated;
grant all on public.earn_quotes, public.earn_executions, public.earn_execution_receipts, public.wallet_leases, public.hodd_live_controls, public.wallet_ownership_proofs to service_role;
create policy "owner reads earn quotes" on public.earn_quotes for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner reads earn executions" on public.earn_executions for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner reads wallet leases" on public.wallet_leases for select to authenticated using ((select auth.uid()) = user_id);
create policy "owner reads ownership proofs" on public.wallet_ownership_proofs for select to authenticated using ((select auth.uid()) = user_id);
create policy "anyone reads live controls" on public.hodd_live_controls for select to anon, authenticated using (true);

-- Atomically consumes a single-use quote and opens its execution. The lease
-- trigger rejects a busy wallet, rolling the quote consumption back too.
create function public.hodd_start_earn_execution(p_user uuid, p_scope text, p_quote uuid, p_binding text, p_policy_digest text, p_ack boolean, p_wallet jsonb, p_started_block text) returns void
language plpgsql security invoker set search_path = '' as $$
declare q public.earn_quotes;
begin
  update public.earn_quotes set consumed_at = now()
    where id = p_quote and user_id = p_user and scope = p_scope and binding = p_binding and policy_digest = p_policy_digest
      and consumed_at is null and expires_at > now()
      and (coalesce((quote->>'requiresWarningAcknowledgement')::boolean, false) = false or p_ack)
    returning * into q;
  if not found then raise exception 'quote not available'; end if;
  if lower(p_wallet->>'address') is distinct from q.wallet_address then raise exception 'quote not available'; end if;
  insert into public.earn_executions(id, user_id, scope, wallet_address, wallet, binding, policy_digest, quote, state, started_block, events)
  values (q.id, p_user, p_scope, q.wallet_address, p_wallet, p_binding, p_policy_digest, q.quote, 'PREPARING', p_started_block, '[{"stage":"USER_CONFIRMED"}]'::jsonb);
end;
$$;
revoke all on function public.hodd_start_earn_execution(uuid, text, uuid, text, text, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.hodd_start_earn_execution(uuid, text, uuid, text, text, boolean, jsonb, text) to service_role;

-- Releases a payment that provably never reached the chain (expired, no hash,
-- unchanged nonce or a terminal provider challenge); the proof is kept.
create function public.hodd_release_unsubmitted_payment(p_user uuid, p_scope text, p_id uuid, p_proof jsonb) returns void
language plpgsql security invoker set search_path = '' as $$
declare p public.payment_proposals;
begin
  if p_scope = 'TREASURY' then perform 1 from public.treasury_workspaces where user_id = p_user for update;
  elsif p_scope = 'SMOKE_TEST' then perform 1 from public.earn_smoke_workspaces where user_id = p_user for update;
  else raise exception 'invalid scope'; end if;
  select * into p from public.payment_proposals where id = p_id and user_id = p_user and scope = p_scope for update;
  if not found or p.state not in ('AWAITING_SIGNATURE','UNKNOWN') or p.tx_hash is not null or p.user_operation_hash is not null
    or p.expires_at > now() or p_proof is null then raise exception 'cannot release payment'; end if;
  update public.payment_proposals set state = 'EXPIRED', release_proof = p_proof, pending = null, updated_at = now() where id = p_id;
  if p_scope = 'TREASURY' then update public.treasury_workspaces set workspace = workspace where user_id = p_user;
  else update public.earn_smoke_workspaces set workspace = workspace where user_id = p_user; end if;
end;
$$;
revoke all on function public.hodd_release_unsubmitted_payment(uuid, text, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.hodd_release_unsubmitted_payment(uuid, text, uuid, jsonb) to service_role;

-- Content-free request counters for the public testnet demo.
create table hodd_private.live_usage (
  key text not null,
  bucket timestamptz not null,
  used integer not null check (used >= 1),
  primary key (key, bucket)
);
alter table hodd_private.live_usage enable row level security;
create index live_usage_bucket_idx on hodd_private.live_usage(bucket);
revoke all on hodd_private.live_usage from public, anon, authenticated;

create function public.hodd_reserve_live_usage(p_kind text) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid(); v_now timestamptz := now(); v_count integer; v_rule jsonb;
  v_rules jsonb := case p_kind
    when 'QUOTE' then '[["user","minute",6],["user","day",60],["global","day",2000]]'
    when 'START' then '[["user","minute",2],["user","day",20],["global","day",1000]]'
    when 'ADVANCE' then '[["user","minute",60]]'
    when 'CIRCLE_SESSION' then '[["user","hour",5],["global","day",300]]'
    when 'OWNERSHIP' then '[["user","minute",5],["user","day",30]]'
    else null end::jsonb;
begin
  if v_user is null or not hodd_private.earn_session_active() then raise exception 'active session required'; end if;
  if v_rules is null then raise exception 'invalid usage kind'; end if;
  for v_rule in select value from jsonb_array_elements(v_rules) loop
    v_count := null;
    insert into hodd_private.live_usage(key, bucket, used)
    values (p_kind || ':' || (v_rule->>1) || ':' || case when v_rule->>0 = 'user' then v_user::text else 'global' end,
      date_trunc(v_rule->>1, v_now at time zone 'UTC') at time zone 'UTC', 1)
    on conflict (key, bucket) do update set used = hodd_private.live_usage.used + 1
      where hodd_private.live_usage.used < (v_rule->>2)::integer
    returning used into v_count;
    if v_count is null then raise exception 'rate limit: %', p_kind; end if;
  end loop;
  delete from hodd_private.live_usage where bucket < v_now - interval '2 days';
end;
$$;
revoke all on function public.hodd_reserve_live_usage(text) from public, anon;
grant execute on function public.hodd_reserve_live_usage(text) to authenticated;

-- Obligations without payment history may now be removed (sample cleanup,
-- mistakes). Anything PAID or ever proposed for payment keeps its record.
create or replace function hodd_private.sync_payment_obligations() returns trigger
language plpgsql security definer set search_path = '' as $$
declare s text; item jsonb; previous public.payment_obligations; normalized jsonb:='[]'; reservations jsonb; pending numeric;
begin
  if auth.uid() is distinct from new.user_id and coalesce(auth.role(),'') <> 'service_role' then raise exception 'owner required'; end if;
  s := case when tg_table_name='treasury_workspaces' then 'TREASURY' else 'SMOKE_TEST' end;
  -- Workspace row locks serialize edits with claim/finalize. Block any active-wallet
  -- financial mutation; receipt finalization marks its payment CONFIRMED first.
  if exists(select 1 from public.payment_proposals p where p.user_id=new.user_id and p.scope=s and p.state in ('AWAITING_SIGNATURE','SUBMITTED','UNKNOWN')) then
    if tg_op='INSERT' or (new.workspace->'policy') is distinct from (old.workspace->'policy') or (new.workspace->'obligations') is distinct from (old.workspace->'obligations') or (new.workspace->'walletConnection') is distinct from (old.workspace->'walletConnection') then raise exception 'payment execution requires completion or review'; end if;
  end if;
  for item in select value from jsonb_array_elements(new.workspace->'obligations') loop
    select * into previous from public.payment_obligations where user_id=new.user_id and scope=s and id=item->>'id' for update;
    if found then
      if previous.body->>'status'='PAID' then item:=previous.body;
      elsif item->>'status'='PAID' or item->>'paymentReference' is not null then raise exception 'receipt required for PAID';
      elsif coalesce((item->>'revision')::integer,1)=previous.revision+1 then
        previous.revision:=previous.revision+1;
      elsif (item - 'revision' - 'paymentReference') is distinct from (previous.body - 'revision' - 'paymentReference') then
        if coalesce((item->>'revision')::integer,1) <> previous.revision+1 then raise exception 'obligation revision conflict'; end if;
        previous.revision:=previous.revision+1;
      end if;
    else
      if item->>'status'='PAID' or item->>'paymentReference' is not null then raise exception 'receipt required for PAID'; end if;
      previous.revision:=1;
    end if;
    item:=jsonb_set(item,'{revision}',to_jsonb(previous.revision));
    insert into public.payment_obligations(user_id,scope,id,revision,body) values(new.user_id,s,item->>'id',previous.revision,item)
      on conflict(user_id,scope,id) do update set revision=excluded.revision,body=excluded.body;
    normalized:=normalized || jsonb_build_array(item);
  end loop;
  if exists(select 1 from public.payment_obligations o where o.user_id=new.user_id and o.scope=s
      and not exists(select 1 from jsonb_array_elements(normalized) j where j->>'id'=o.id)
      and (o.body->>'status'='PAID' or o.payment_reference is not null
        or exists(select 1 from public.payment_proposals p where p.user_id=o.user_id and p.scope=o.scope and p.obligation_id=o.id))) then
    raise exception 'obligation deletion is not supported';
  end if;
  delete from public.payment_obligations o where o.user_id=new.user_id and o.scope=s
    and not exists(select 1 from jsonb_array_elements(normalized) j where j->>'id'=o.id);
  select coalesce(jsonb_agg(jsonb_build_object('proposalId',p.id,'obligationId',p.obligation_id,'amount',p.proposal->'amount','feeReserve',p.proposal->'feeReserve')),'[]'),coalesce(sum((p.proposal->'amount'->>'minorUnits')::numeric+(p.proposal->'feeReserve'->>'minorUnits')::numeric),0)
    into reservations,pending from public.payment_proposals p where p.user_id=new.user_id and p.scope=s and p.state in ('AWAITING_SIGNATURE','SUBMITTED','UNKNOWN');
  new.workspace:=jsonb_set(jsonb_set(jsonb_set(new.workspace,'{obligations}',normalized),'{paymentReservations}',reservations),'{pendingTransactions}',jsonb_build_object('currency','USDC','decimals',6,'minorUnits',pending::text));
  return new;
end;
$$;
revoke all on function hodd_private.sync_payment_obligations() from public, anon, authenticated;
