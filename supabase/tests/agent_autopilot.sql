-- Rollback-only synthetic agent wallets. Never uses Circle or real onchain addresses.
begin;
do $$
declare alice uuid:=gen_random_uuid(); bob uuid:=gen_random_uuid(); run_a uuid:=gen_random_uuid(); run_b uuid:=gen_random_uuid(); step_a uuid:=gen_random_uuid(); n integer; t text; rejected boolean;
  m jsonb:='{"budgetMinor":"1000000","reserveMinor":"100000","maxPerRunMinor":"500000","maxMorphoBps":4000,"enabled":true,"paused":false}';
begin
  foreach t in array array['public.agent_wallets','public.agent_mandates','public.agent_runs','public.agent_run_steps'] loop
    if has_table_privilege('authenticated',t,'INSERT') or has_table_privilege('authenticated',t,'UPDATE') or has_table_privilege('authenticated',t,'DELETE') then raise exception 'browser write allowed: %',t; end if;
    if not has_table_privilege('authenticated',t,'SELECT') then raise exception 'owner cannot read %',t; end if;
  end loop;
  if has_function_privilege('authenticated','public.hodd_start_agent_run(uuid,uuid,jsonb,jsonb,jsonb,boolean,bigint)','EXECUTE') or has_function_privilege('anon','public.hodd_confirm_agent_review(uuid,uuid,text,text)','EXECUTE') then raise exception 'browser server RPC exposed'; end if;
  if (select enabled from public.hodd_live_controls where key='AGENT') is distinct from false then raise exception 'agent must start disabled'; end if;
  insert into auth.users(id,is_sso_user,is_anonymous) values(alice,false,false),(bob,false,false);
  insert into public.agent_wallets(user_id,circle_wallet_id,wallet_set_id,address,owner_address,account_type) values
    (alice,gen_random_uuid(),gen_random_uuid(),'0x00000000000000000000000000000000000000aa','0x00000000000000000000000000000000000000a1','EOA'),
    (bob,gen_random_uuid(),gen_random_uuid(),'0x00000000000000000000000000000000000000bb','0x00000000000000000000000000000000000000b1','EOA');
  insert into public.agent_mandates(user_id,mandate) values(alice,m),(bob,m);
  perform public.hodd_start_agent_run(run_a,alice,'{}','{"kind":"INVEST"}',null,false,1);
  rejected:=false;
  begin perform public.hodd_start_agent_run(run_b,alice,'{}','{"kind":"INVEST"}',null,false,1); exception when raise_exception or unique_violation then rejected:=true; end;
  if not rejected then raise exception 'overlap/rate limit not enforced'; end if;
  update public.agent_runs set state='UNKNOWN' where id=run_a;
  rejected:=false;
  begin insert into public.agent_runs(id,user_id,state,snapshot,decision) values(run_b,alice,'RUNNING','{}','{}'); exception when unique_violation then rejected:=true; end;
  if not rejected then raise exception 'UNKNOWN released open run constraint'; end if;
  if not public.hodd_claim_agent_run(run_a,gen_random_uuid()) then raise exception 'lease not acquired'; end if;
  if public.hodd_claim_agent_run(run_a,gen_random_uuid()) then raise exception 'lease acquired twice'; end if;
  insert into public.agent_run_steps(id,run_id,user_id,state,stage,call,gas_limit,gas_price_wei,started_block,amount_minor)
  values(step_a,run_a,alice,'SUBMITTED','TRANSFER','{}','100','20000000000','1',100000);
  rejected:=false;
  begin insert into public.agent_run_steps(id,run_id,user_id,state,stage,call,gas_limit,gas_price_wei,started_block,amount_minor)
    values(gen_random_uuid(),run_a,bob,'PREPARED','TRANSFER','{}','1','1','1',1); exception when foreign_key_violation then rejected:=true; end;
  if not rejected then raise exception 'cross-owner step linkage allowed'; end if;
  update public.agent_run_steps set state='VERIFIED',tx_hash='0x'||repeat('a',64),receipt='{"feeMinor":"100","status":"VERIFIED"}' where id=step_a;
  if (select spent_minor from public.agent_mandates where user_id=alice)<>100100 then raise exception 'verified return not accounted'; end if;
  update public.agent_run_steps set state='VERIFIED' where id=step_a;
  if (select spent_minor from public.agent_mandates where user_id=alice)<>100100 then raise exception 'verified return counted twice'; end if;
  update public.agent_runs set state='PARTIAL' where id=run_a;
  insert into public.agent_runs(id,user_id,state,snapshot,decision) values(run_b,bob,'NO_ACTION','{}','{}');
  perform set_config('request.jwt.claims',jsonb_build_object('sub',alice,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  foreach t in array array['agent_wallets','agent_mandates','agent_runs','agent_run_steps'] loop
    execute format('select count(*) from public.%I',t) into n;
    if n<>1 then raise exception 'owner isolation failed %: %',t,n; end if;
  end loop;
  rejected:=false;
  begin update public.agent_mandates set spent_minor=0 where user_id=alice; exception when insufficient_privilege then rejected:=true; end;
  if not rejected then raise exception 'browser wrote mandate'; end if;
  execute 'reset role';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',bob,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  select count(*) into n from public.agent_run_steps;
  if n<>0 then raise exception 'foreign step visible'; end if;
end; $$;
rollback;
