-- Stage 5: browser-readable, server-written payment ledger. No funds move in SQL.
create table public.payment_obligations (
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check(scope in ('TREASURY','SMOKE_TEST')),
  id text not null, revision integer not null check(revision > 0), body jsonb not null,
  payment_reference uuid, primary key(user_id,scope,id)
);
create table public.payment_proposals (
  id uuid primary key, user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check(scope in ('TREASURY','SMOKE_TEST')), obligation_id text not null,
  wallet_address text not null, binding text not null, policy_digest text not null,
  policy_snapshot jsonb not null, obligation_snapshot jsonb not null, pending_snapshot jsonb not null,
  proposal jsonb not null, expires_at timestamptz not null,
  state text not null default 'REVIEW_REQUIRED' check(state in ('REVIEW_REQUIRED','AWAITING_SIGNATURE','SUBMITTED','CONFIRMED','FAILED','CANCELLED','EXPIRED','UNKNOWN')),
  tx_hash text check(tx_hash ~ '^0x[0-9a-fA-F]{64}$'),
  user_operation_hash text check(user_operation_hash ~ '^0x[0-9a-fA-F]{64}$'), receipt jsonb,
  updated_at timestamptz not null default now(),
  check(state <> 'CONFIRMED' or (tx_hash is not null and receipt is not null and receipt->>'logIndex' ~ '^\d+$' and receipt->>'blockNumber' ~ '^\d+$')),
  foreign key(user_id,scope,obligation_id) references public.payment_obligations(user_id,scope,id)
);
create unique index payment_one_active_obligation on public.payment_proposals(user_id,scope,obligation_id) where state in ('AWAITING_SIGNATURE','SUBMITTED','UNKNOWN');
create unique index payment_one_active_wallet on public.payment_proposals(lower(wallet_address)) where state in ('AWAITING_SIGNATURE','SUBMITTED','UNKNOWN');
create unique index payment_unique_confirmed_receipt on public.payment_proposals(lower(tx_hash), (receipt->>'logIndex')) where state='CONFIRMED';
create table public.wallet_provider_verifications (
  provider text primary key check(provider in ('CIRCLE_USER_CONTROLLED','CIRCLE_MODULAR','INJECTED_METAMASK','INJECTED_RABBY')),
  deposit_hash text not null, withdrawal_hash text not null, redeem_hash text not null,
  verified_at timestamptz not null default now()
);
alter table public.payment_obligations enable row level security;
alter table public.payment_proposals enable row level security;
alter table public.wallet_provider_verifications enable row level security;
revoke all on public.payment_obligations, public.payment_proposals, public.wallet_provider_verifications from public, anon, authenticated;
grant select on public.payment_obligations, public.payment_proposals, public.wallet_provider_verifications to authenticated;
grant all on public.payment_obligations, public.payment_proposals, public.wallet_provider_verifications to service_role;
create policy "owner reads obligations" on public.payment_obligations for select to authenticated using((select auth.uid())=user_id);
create policy "owner reads payments" on public.payment_proposals for select to authenticated using((select auth.uid())=user_id);
create policy "signed in reads provider readiness" on public.wallet_provider_verifications for select to authenticated using(true);

-- Preserve existing records, including explicitly labelled historical demo PAID.
insert into public.payment_obligations(user_id,scope,id,revision,body)
select user_id,'TREASURY',item->>'id',1,item from public.treasury_workspaces cross join lateral jsonb_array_elements(workspace->'obligations') item;
insert into public.payment_obligations(user_id,scope,id,revision,body)
select user_id,'SMOKE_TEST',item->>'id',1,item from public.earn_smoke_workspaces cross join lateral jsonb_array_elements(workspace->'obligations') item;

create function hodd_private.sync_payment_obligations() returns trigger
language plpgsql security definer set search_path='' as $$
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
  if exists(select 1 from public.payment_obligations o where o.user_id=new.user_id and o.scope=s and not exists(select 1 from jsonb_array_elements(normalized) j where j->>'id'=o.id)) then raise exception 'obligation deletion is not supported'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('proposalId',p.id,'obligationId',p.obligation_id,'amount',p.proposal->'amount','feeReserve',p.proposal->'feeReserve')),'[]'),coalesce(sum((p.proposal->'amount'->>'minorUnits')::numeric+(p.proposal->'feeReserve'->>'minorUnits')::numeric),0)
    into reservations,pending from public.payment_proposals p where p.user_id=new.user_id and p.scope=s and p.state in ('AWAITING_SIGNATURE','SUBMITTED','UNKNOWN');
  new.workspace:=jsonb_set(jsonb_set(jsonb_set(new.workspace,'{obligations}',normalized),'{paymentReservations}',reservations),'{pendingTransactions}',jsonb_build_object('currency','USDC','decimals',6,'minorUnits',pending::text));
  return new;
end;
$$;
revoke all on function hodd_private.sync_payment_obligations() from public,anon,authenticated;
create trigger payment_obligation_sync before insert or update on public.treasury_workspaces for each row execute function hodd_private.sync_payment_obligations();
create trigger payment_smoke_obligation_sync before insert or update on public.earn_smoke_workspaces for each row execute function hodd_private.sync_payment_obligations();

create function public.hodd_claim_payment(p_user uuid,p_scope text,p_id uuid,p_binding text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare p public.payment_proposals; w jsonb; o public.payment_obligations;
begin
  if p_scope='TREASURY' then select workspace into w from public.treasury_workspaces where user_id=p_user for update;
  elsif p_scope='SMOKE_TEST' then select workspace into w from public.earn_smoke_workspaces where user_id=p_user for update;
  else raise exception 'invalid scope'; end if;
  select * into p from public.payment_proposals where id=p_id and user_id=p_user and scope=p_scope for update;
  if not found or p.binding<>p_binding or p.state<>'REVIEW_REQUIRED' or p.expires_at<=now() or p.proposal->'policy'->>'status'<>'PASS' or not (p.proposal->>'executionEnabled')::boolean then raise exception 'proposal not executable'; end if;
  select * into o from public.payment_obligations where user_id=p_user and scope=p_scope and id=p.obligation_id;
  if w is null or o.id is null or o.revision is distinct from (p.proposal->>'obligationRevision')::integer
    or o.body->>'status' not in ('UPCOMING','OVERDUE')
    or w->'policy' is distinct from p.policy_snapshot
    or w->'obligations' is distinct from p.obligation_snapshot
    or w->'pendingTransactions' is distinct from p.pending_snapshot
    or w->'walletConnection' is distinct from p.proposal->'wallet' then raise exception 'workspace changed'; end if;
  update public.payment_proposals set state='AWAITING_SIGNATURE',updated_at=now() where id=p_id;
  -- Reserve using the trigger; no obligation or policy mutation.
  if p_scope='TREASURY' then update public.treasury_workspaces set workspace=workspace where user_id=p_user;
  else update public.earn_smoke_workspaces set workspace=workspace where user_id=p_user; end if;
  return p.proposal;
end;
$$;
revoke all on function public.hodd_claim_payment(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.hodd_claim_payment(uuid,text,uuid,text) to service_role;

create function public.hodd_finish_payment(p_user uuid,p_scope text,p_id uuid,p_hash text,p_receipt jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare p public.payment_proposals; w jsonb; normalized jsonb;
begin
  if p_scope='TREASURY' then select workspace into w from public.treasury_workspaces where user_id=p_user for update;
  elsif p_scope='SMOKE_TEST' then select workspace into w from public.earn_smoke_workspaces where user_id=p_user for update;
  else raise exception 'invalid scope'; end if;
  select * into p from public.payment_proposals where id=p_id and user_id=p_user and scope=p_scope for update;
  if not found or p.state not in ('AWAITING_SIGNATURE','SUBMITTED','UNKNOWN') or (p.tx_hash is not null and lower(p.tx_hash)<>lower(p_hash)) then raise exception 'execution unavailable'; end if;
  update public.payment_proposals set state='CONFIRMED',tx_hash=p_hash,receipt=p_receipt,updated_at=now() where id=p_id;
  update public.payment_obligations set body=body || jsonb_build_object('status','PAID','paymentReference',p_id),payment_reference=p_id where user_id=p_user and scope=p_scope and id=p.obligation_id;
  select jsonb_agg(o.body order by j.ordinality) into normalized from jsonb_array_elements(w->'obligations') with ordinality j(value,ordinality) join public.payment_obligations o on o.user_id=p_user and o.scope=p_scope and o.id=j.value->>'id';
  w:=jsonb_set(w,'{obligations}',normalized);
  if p_scope='TREASURY' then update public.treasury_workspaces set workspace=w,updated_at=now() where user_id=p_user;
  else update public.earn_smoke_workspaces set workspace=w,updated_at=now() where user_id=p_user; end if;
end;
$$;
revoke all on function public.hodd_finish_payment(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.hodd_finish_payment(uuid,text,uuid,text,jsonb) to service_role;

-- A terminal pre-submission outcome releases the reservation atomically. UNKNOWN
-- is intentionally not reset: absence of a receipt is not evidence of failure.
create function public.hodd_cancel_payment(p_user uuid,p_scope text,p_id uuid,p_binding text,p_state text) returns void
language plpgsql security invoker set search_path='' as $$
declare p public.payment_proposals;
begin
  if p_state not in ('CANCELLED','FAILED','EXPIRED') then raise exception 'invalid terminal state'; end if;
  if p_scope='TREASURY' then perform 1 from public.treasury_workspaces where user_id=p_user for update;
  elsif p_scope='SMOKE_TEST' then perform 1 from public.earn_smoke_workspaces where user_id=p_user for update;
  else raise exception 'invalid scope'; end if;
  select * into p from public.payment_proposals where id=p_id and user_id=p_user and scope=p_scope for update;
  if not found or p.binding<>p_binding or p.state not in ('REVIEW_REQUIRED','AWAITING_SIGNATURE') or p.tx_hash is not null or p.user_operation_hash is not null then raise exception 'cannot release uncertain payment'; end if;
  update public.payment_proposals set state=p_state,updated_at=now() where id=p_id;
  if p_scope='TREASURY' then update public.treasury_workspaces set workspace=workspace where user_id=p_user;
  else update public.earn_smoke_workspaces set workspace=workspace where user_id=p_user; end if;
end;
$$;
revoke all on function public.hodd_cancel_payment(uuid,text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.hodd_cancel_payment(uuid,text,uuid,text,text) to service_role;
