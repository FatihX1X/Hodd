-- Rollback-only synthetic fixtures. No blockchain or user credentials involved.
begin;
do $$
<<tests>>
declare owner_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); proposal_id uuid:=gen_random_uuid(); evidence_id uuid:=gen_random_uuid(); w jsonb; item jsonb; wallet jsonb; hash text:='0x'||repeat('1',64); rejected boolean; count_rows integer;
begin
  if has_table_privilege('authenticated','public.earn_provider_evidence','INSERT') or has_table_privilege('authenticated','public.earn_provider_evidence','UPDATE') or has_function_privilege('authenticated','public.hodd_fail_payment_receipt(uuid,text,uuid,text,jsonb)','EXECUTE') or has_function_privilege('authenticated','public.hodd_fail_payment_user_operation(uuid,text,uuid,text,jsonb)','EXECUTE') then raise exception 'browser proof mutation allowed'; end if;
  insert into auth.users(id,is_sso_user,is_anonymous) values(owner_id,false,false),(other_id,false,false);
  wallet:=jsonb_build_object('provider','INJECTED_RABBY','chain','ARC-TESTNET','chainId',5042002,'accountType','EOA','address','0x0000000000000000000000000000000000000001');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','service_role')::text,true);
  insert into public.earn_provider_evidence(id,user_id,provider,wallet_address,wallet,quote,result,started_block,verified_block,sdk_versions)
  values(evidence_id,owner_id,'INJECTED_RABBY',wallet->>'address',wallet,'{}',jsonb_build_object('status','COMPLETE','txHash',hash),10,11,'{}');
  execute 'set local role authenticated';
  select count(*) into count_rows from public.earn_provider_evidence where user_id=owner_id;
  if count_rows<>1 then raise exception 'owner evidence read failed'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','authenticated')::text,true);
  select count(*) into count_rows from public.earn_provider_evidence where user_id=owner_id;
  if count_rows<>0 then raise exception 'cross-user proof exposure'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','service_role')::text,true);
  item:=jsonb_build_object('id','synthetic-recovery','revision',1,'status','UPCOMING','title','SQL-only test','amount',jsonb_build_object('currency','USDC','decimals',6,'minorUnits','1000000'));
  w:=jsonb_build_object('schemaVersion',4,'obligations',jsonb_build_array(item),'policy','{}'::jsonb,'walletConnection',wallet,'pendingTransactions',jsonb_build_object('currency','USDC','decimals',6,'minorUnits','0'));
  insert into public.treasury_workspaces(user_id,schema_version,workspace) values(owner_id,4,w);
  insert into public.payment_proposals(id,user_id,scope,obligation_id,wallet_address,binding,policy_digest,policy_snapshot,obligation_snapshot,pending_snapshot,proposal,expires_at)
  values(proposal_id,owner_id,'TREASURY','synthetic-recovery',wallet->>'address','binding','digest',w->'policy',w->'obligations',w->'pendingTransactions',jsonb_build_object('obligationRevision',1,'wallet',wallet,'executionEnabled',true,'policy',jsonb_build_object('status','PASS'),'amount',item->'amount','feeReserve',jsonb_build_object('currency','USDC','decimals',6,'minorUnits','1000'),'startBlock','10'),now()+interval '5 minutes');
  perform public.hodd_claim_payment(owner_id,'TREASURY',proposal_id,'binding');
  update public.payment_proposals set state='UNKNOWN',tx_hash=hash where id=proposal_id;
  rejected:=false;
  begin perform public.hodd_cancel_payment(owner_id,'TREASURY',proposal_id,'binding','CANCELLED'); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'unknown released without proof'; end if;
  rejected:=false;
  begin perform public.hodd_fail_payment_receipt(other_id,'TREASURY',proposal_id,hash,jsonb_build_object('status','REVERTED','blockNumber','11')); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'cross-user failure recovery'; end if;
  rejected:=false;
  begin perform public.hodd_fail_payment_receipt(owner_id,'TREASURY',proposal_id,hash,jsonb_build_object('status','REVERTED','blockNumber','10')); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'stale failure proof accepted'; end if;
  perform public.hodd_fail_payment_receipt(owner_id,'TREASURY',proposal_id,hash,jsonb_build_object('status','REVERTED','blockNumber','11'));
  select workspace into w from public.treasury_workspaces where user_id=owner_id;
  if w->'pendingTransactions'->>'minorUnits'<>'0' or w->'obligations'->0->>'status'<>'UPCOMING' then raise exception 'failure marked paid or kept reservation'; end if;
  if not exists(select 1 from public.payment_events e where e.proposal_id=tests.proposal_id and e.stage='FAILED' and e.kind='ONCHAIN_RECEIPT') then raise exception 'failure receipt audit missing'; end if;
  -- An outer successful transaction may contain a reverted UserOperation.
  wallet:=wallet || jsonb_build_object('provider','CIRCLE_MODULAR','accountType','MSCA');
  w:=jsonb_set(w,'{walletConnection}',wallet);
  update public.treasury_workspaces set workspace=w where user_id=owner_id;
  proposal_id:=gen_random_uuid();
  insert into public.payment_proposals(id,user_id,scope,obligation_id,wallet_address,binding,policy_digest,policy_snapshot,obligation_snapshot,pending_snapshot,proposal,expires_at)
  values(proposal_id,owner_id,'TREASURY','synthetic-recovery',wallet->>'address','binding','digest',w->'policy',w->'obligations',w->'pendingTransactions',jsonb_build_object('obligationRevision',1,'wallet',wallet,'executionEnabled',true,'policy',jsonb_build_object('status','PASS'),'amount',item->'amount','feeReserve',jsonb_build_object('currency','USDC','decimals',6,'minorUnits','0'),'startBlock','10','feeQuote',jsonb_build_object('userOperation',jsonb_build_object('nonce','0','paymaster','0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25'))),now()+interval '5 minutes');
  perform public.hodd_claim_payment(owner_id,'TREASURY',proposal_id,'binding');
  update public.payment_proposals set state='UNKNOWN',user_operation_hash=hash where id=proposal_id;
  rejected:=false;
  begin perform public.hodd_fail_payment_user_operation(owner_id,'TREASURY',proposal_id,hash,jsonb_build_object('status','USER_OPERATION_REVERTED','success',false,'blockNumber','11','nonce','1','paymaster','0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25','userOperationHash',hash)); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'wrong nonce failure proof accepted'; end if;
  perform public.hodd_fail_payment_user_operation(owner_id,'TREASURY',proposal_id,hash,jsonb_build_object('status','USER_OPERATION_REVERTED','success',false,'blockNumber','11','nonce','0','paymaster','0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25','userOperationHash',hash));
  select workspace into w from public.treasury_workspaces where user_id=owner_id;
  if w->'pendingTransactions'->>'minorUnits'<>'0' or w->'obligations'->0->>'status'<>'UPCOMING' then raise exception 'user operation failure marked paid or kept reservation'; end if;
  raise notice 'evidence privileges, ownership, unknown retention, verified failure release and active obligation checks passed';
end;
$$;
rollback;
