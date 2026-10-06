-- Evidence is produced by a receipt-verifying server job, never by browser flags.
create table public.earn_provider_evidence (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check(provider in ('CIRCLE_USER_CONTROLLED','CIRCLE_MODULAR','INJECTED_METAMASK','INJECTED_RABBY')),
  wallet_address text not null check(wallet_address ~ '^0x[0-9a-f]{40}$'),
  wallet jsonb not null, quote jsonb not null, result jsonb not null,
  started_block numeric(78,0) not null check(started_block >= 0),
  verified_block numeric(78,0) not null check(verified_block > started_block),
  sdk_versions jsonb not null, verified_at timestamptz not null default now(),
  check(wallet->>'chain'='ARC-TESTNET' and wallet->>'chainId'='5042002'),
  check(wallet->>'provider'=provider and lower(wallet->>'address')=wallet_address),
  check(result->>'status'='COMPLETE' and result->>'txHash' ~ '^0x[0-9a-fA-F]{64}$')
);
create unique index earn_provider_evidence_receipt on public.earn_provider_evidence(user_id,provider,wallet_address,(result->>'txHash'));
create index earn_provider_evidence_owner_wallet on public.earn_provider_evidence(user_id,provider,wallet_address,verified_block desc);
alter table public.earn_provider_evidence enable row level security;
revoke all on public.earn_provider_evidence from public,anon,authenticated;
grant select on public.earn_provider_evidence to authenticated;
grant all on public.earn_provider_evidence to service_role;
create policy "owner reads verified earn evidence" on public.earn_provider_evidence for select to authenticated using((select auth.uid())=user_id);

alter table public.payment_proposals add column provider_transaction_id text;
alter table public.payment_proposals add column failure_receipt jsonb;

-- Only service_role can release a submitted reservation with verified failure.
-- The server verifies Arc chain, fresh block and the exact EOA call beforehand.
create function public.hodd_fail_payment_receipt(p_user uuid,p_scope text,p_id uuid,p_hash text,p_receipt jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare p public.payment_proposals;
begin
  if p_scope='TREASURY' then perform 1 from public.treasury_workspaces where user_id=p_user for update;
  elsif p_scope='SMOKE_TEST' then perform 1 from public.earn_smoke_workspaces where user_id=p_user for update;
  else raise exception 'invalid scope'; end if;
  select * into p from public.payment_proposals where id=p_id and user_id=p_user and scope=p_scope for update;
  if not found or p.state not in ('AWAITING_SIGNATURE','SUBMITTED','UNKNOWN') or p.proposal->'wallet'->>'accountType'<>'EOA'
    or p_hash !~ '^0x[0-9a-fA-F]{64}$' or (p.tx_hash is not null and lower(p.tx_hash)<>lower(p_hash))
    or p_receipt->>'status' is distinct from 'REVERTED' or p_receipt->>'blockNumber' is null
    or (p_receipt->>'blockNumber')::numeric <= (p.proposal->>'startBlock')::numeric then raise exception 'failure receipt not verified'; end if;
  update public.payment_proposals set state='FAILED',tx_hash=p_hash,failure_receipt=p_receipt,updated_at=now() where id=p_id;
  -- Leave the obligation active. The existing trigger recomputes reservations.
  if p_scope='TREASURY' then update public.treasury_workspaces set workspace=workspace,updated_at=now() where user_id=p_user;
  else update public.earn_smoke_workspaces set workspace=workspace,updated_at=now() where user_id=p_user; end if;
end;
$$;
revoke all on function public.hodd_fail_payment_receipt(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.hodd_fail_payment_receipt(uuid,text,uuid,text,jsonb) to service_role;

create or replace function hodd_private.record_payment_transition() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' or new.state is distinct from old.state then
    insert into public.payment_events(proposal_id,user_id,scope,stage,kind,tx_hash)
    values(new.id,new.user_id,new.scope,new.state,
      case when new.state='CONFIRMED' or (new.state='FAILED' and new.failure_receipt is not null) then 'ONCHAIN_RECEIPT' else 'LOCAL_AUDIT' end,new.tx_hash);
  end if;
  return new;
end;
$$;
