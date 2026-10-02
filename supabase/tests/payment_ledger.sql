-- Synthetic users/workspaces only. Always roll back; no RPC or wallet signing.
begin;
do $$
declare owner_id uuid:=gen_random_uuid(); other_id uuid:=gen_random_uuid(); proposal_id uuid:=gen_random_uuid(); item jsonb; w jsonb; rejected boolean; count_rows integer;
begin
  if has_table_privilege('authenticated','public.payment_proposals','INSERT') or has_table_privilege('authenticated','public.payment_obligations','UPDATE') or has_function_privilege('authenticated','public.hodd_claim_payment(uuid,text,uuid,text)','EXECUTE') then raise exception 'browser write privilege'; end if;
  insert into auth.users(id,is_sso_user,is_anonymous) values(owner_id,false,false),(other_id,false,false);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
  item:=jsonb_build_object('id','synthetic-payment','revision',1,'status','UPCOMING','title','SQL-only smoke fixture','amount',jsonb_build_object('currency','USDC','decimals',6,'minorUnits','1000000'));
  w:=jsonb_build_object('schemaVersion',4,'obligations',jsonb_build_array(item),'policy',jsonb_build_object('test','unchanged'),'walletConnection',null,'pendingTransactions',jsonb_build_object('currency','USDC','decimals',6,'minorUnits','0'));
  insert into public.treasury_workspaces(user_id,schema_version,workspace) values(owner_id,4,w);
  rejected:=false;
  begin update public.treasury_workspaces set workspace=jsonb_set(workspace,'{obligations,0,status}','"PAID"') where user_id=owner_id;
  exception when raise_exception then rejected:=sqlerrm='receipt required for PAID'; end;
  if not rejected then raise exception 'forged PAID accepted'; end if;
  execute 'set local role authenticated';
  select count(*) into count_rows from public.payment_obligations where user_id=owner_id;
  if count_rows<>1 then raise exception 'owner read failed'; end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',other_id,'role','authenticated')::text,true);
  select count(*) into count_rows from public.payment_obligations where user_id=owner_id;
  if count_rows<>0 then raise exception 'cross-user read allowed'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','service_role')::text,true);
  insert into public.payment_proposals(id,user_id,scope,obligation_id,wallet_address,binding,policy_digest,policy_snapshot,obligation_snapshot,pending_snapshot,proposal,expires_at)
  values(proposal_id,owner_id,'TREASURY','synthetic-payment','synthetic-no-wallet','test-binding','digest',w->'policy',w->'obligations',w->'pendingTransactions',jsonb_build_object('obligationRevision',1,'wallet',null,'executionEnabled',true,'policy',jsonb_build_object('status','PASS'),'amount',item->'amount','feeReserve',jsonb_build_object('currency','USDC','decimals',6,'minorUnits','1000')),now()+interval '5 minutes');
  rejected:=false;
  begin perform public.hodd_claim_payment(other_id,'TREASURY',proposal_id,'test-binding'); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'cross-user claim allowed'; end if;
  perform public.hodd_claim_payment(owner_id,'TREASURY',proposal_id,'test-binding');
  select workspace into w from public.treasury_workspaces where user_id=owner_id;
  if w->'pendingTransactions'->>'minorUnits'<>'1001000' or jsonb_array_length(w->'paymentReservations')<>1 then raise exception 'reservation missing or duplicated'; end if;
  rejected:=false;
  begin perform public.hodd_claim_payment(owner_id,'TREASURY',proposal_id,'test-binding'); exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'proposal replay allowed'; end if;
  rejected:=false;
  begin update public.treasury_workspaces set workspace=jsonb_set(workspace,'{policy,test}','"changed"') where user_id=owner_id; exception when raise_exception then rejected:=true; end;
  if not rejected then raise exception 'active payment policy mutation allowed'; end if;
  perform public.hodd_cancel_payment(owner_id,'TREASURY',proposal_id,'test-binding','CANCELLED');
  select workspace into w from public.treasury_workspaces where user_id=owner_id;
  if w->'pendingTransactions'->>'minorUnits'<>'0' then raise exception 'cancel reservation retained'; end if;
  raise notice 'payment ledger privileges, ownership, PAID guard, claim/replay, reservation and cancellation tests passed';
end;
$$;
rollback;
