create function public.hodd_fail_payment_user_operation(p_user uuid,p_scope text,p_id uuid,p_hash text,p_receipt jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare p public.payment_proposals;
begin
  if p_scope='TREASURY' then perform 1 from public.treasury_workspaces where user_id=p_user for update;
  elsif p_scope='SMOKE_TEST' then perform 1 from public.earn_smoke_workspaces where user_id=p_user for update;
  else raise exception 'invalid scope'; end if;
  select * into p from public.payment_proposals where id=p_id and user_id=p_user and scope=p_scope for update;
  if not found or p.state not in ('AWAITING_SIGNATURE','SUBMITTED','UNKNOWN') or p.proposal->'wallet'->>'provider' is distinct from 'CIRCLE_MODULAR'
    or p.proposal->'wallet'->>'accountType' is distinct from 'MSCA' or p_hash !~ '^0x[0-9a-fA-F]{64}$'
    or (p.tx_hash is not null and lower(p.tx_hash)<>lower(p_hash))
    or p_receipt->>'status' is distinct from 'USER_OPERATION_REVERTED' or p_receipt->>'success' is distinct from 'false'
    or p_receipt->>'blockNumber' is null or (p_receipt->>'blockNumber')::numeric <= (p.proposal->>'startBlock')::numeric
    or p_receipt->>'nonce' is distinct from p.proposal->'feeQuote'->'userOperation'->>'nonce'
    or lower(p_receipt->>'paymaster') is distinct from lower(p.proposal->'feeQuote'->'userOperation'->>'paymaster')
    or p_receipt->>'userOperationHash' is null or p_receipt->>'userOperationHash' !~ '^0x[0-9a-fA-F]{64}$'
    or (p.user_operation_hash is not null and lower(p.user_operation_hash)<>lower(p_receipt->>'userOperationHash')) then raise exception 'user operation failure not verified'; end if;
  update public.payment_proposals set state='FAILED',tx_hash=p_hash,user_operation_hash=p_receipt->>'userOperationHash',failure_receipt=p_receipt,updated_at=now() where id=p_id;
  if p_scope='TREASURY' then update public.treasury_workspaces set workspace=workspace,updated_at=now() where user_id=p_user;
  else update public.earn_smoke_workspaces set workspace=workspace,updated_at=now() where user_id=p_user; end if;
end;
$$;
revoke all on function public.hodd_fail_payment_user_operation(uuid,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.hodd_fail_payment_user_operation(uuid,text,uuid,text,jsonb) to service_role;

create or replace function hodd_private.record_payment_transition() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' or new.state is distinct from old.state then
    insert into public.payment_events(proposal_id,user_id,scope,stage,kind,tx_hash)
    values(new.id,new.user_id,new.scope,new.state,
      case when new.state='CONFIRMED' or (new.state='FAILED' and new.failure_receipt is not null) then 'ONCHAIN_RECEIPT' else 'LOCAL_AUDIT' end,new.tx_hash);
  end if;
  if tg_op='UPDATE' and new.state='AWAITING_SIGNATURE' and old.state='REVIEW_REQUIRED' then
    insert into public.payment_events(proposal_id,user_id,scope,stage,kind) values(new.id,new.user_id,new.scope,'USER_CONFIRMED','LOCAL_AUDIT');
  end if;
  if tg_op='UPDATE' and new.user_operation_hash is not null and old.user_operation_hash is null then
    insert into public.payment_events(proposal_id,user_id,scope,stage,kind) values(new.id,new.user_id,new.scope,'USER_OPERATION_SUBMITTED','LOCAL_AUDIT');
  end if;
  return new;
end;
$$;
