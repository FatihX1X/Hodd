-- Rollback-only synthetic fixtures for Stage 6 connector writes. No real users or wallets.
begin;
do $$
declare owner_id uuid := gen_random_uuid(); other_id uuid := gen_random_uuid(); w jsonb; rev bigint; rejected boolean; n integer;
  action_id uuid := gen_random_uuid(); request_id uuid := gen_random_uuid();
begin
  if has_table_privilege('authenticated', 'public.agent_actions', 'INSERT') or has_table_privilege('authenticated', 'public.agent_actions', 'UPDATE') then raise exception 'browser can write agent_actions'; end if;
  insert into auth.users(id, is_sso_user, is_anonymous) values (owner_id, false, false), (other_id, false, false);
  w := jsonb_build_object('schemaVersion', 4, 'obligations', '[]'::jsonb, 'policy', '{}'::jsonb, 'walletConnection', null, 'pendingTransactions', jsonb_build_object('currency','USDC','decimals',6,'minorUnits','0'));
  perform set_config('request.jwt.claims', jsonb_build_object('role','service_role')::text, true);
  insert into public.treasury_workspaces(user_id, schema_version, workspace) values (owner_id, 4, w);

  -- Revision guard: stale writes conflict, matching writes advance by one.
  select revision into rev from public.treasury_workspaces where user_id = owner_id;
  if rev <> 0 then raise exception 'initial revision %', rev; end if;
  update public.treasury_workspaces set workspace = w, revision = 0 where user_id = owner_id;
  select revision into rev from public.treasury_workspaces where user_id = owner_id;
  if rev <> 1 then raise exception 'revision did not advance'; end if;
  rejected := false;
  begin update public.treasury_workspaces set workspace = w, revision = 0 where user_id = owner_id; exception when serialization_failure then rejected := sqlerrm = 'workspace revision conflict'; end;
  if not rejected then raise exception 'stale revision accepted'; end if;
  update public.treasury_workspaces set workspace = w where user_id = owner_id; -- legacy writer without revision still works
  select revision into rev from public.treasury_workspaces where user_id = owner_id;
  if rev <> 2 then raise exception 'legacy write did not advance revision'; end if;

  -- A browser session (no client_id claim) cannot use the connector writer.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  rejected := false;
  begin perform public.hodd_apply_agent_action(action_id, 'TREASURY', 'UPDATE_POLICY', '{}', 'browser attempt', 'APPLIED', null, w, 2); exception when raise_exception then rejected := sqlerrm = 'connector token required'; end;
  if not rejected then raise exception 'browser session used connector writer'; end if;

  -- Connector token: applies atomically at the expected revision, once.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated', 'client_id', 'claude-test-client')::text, true);
  rev := public.hodd_apply_agent_action(action_id, 'TREASURY', 'UPDATE_POLICY', '{"safetyBuffer":"1"}', 'Raise safety buffer', 'APPLIED', null, w || '{"note":"agent"}', 2);
  if rev <> 3 then raise exception 'connector write revision %', rev; end if;
  rejected := false;
  begin perform public.hodd_apply_agent_action(action_id, 'TREASURY', 'UPDATE_POLICY', '{}', 'replay', 'APPLIED', null, w, 3); exception when unique_violation then rejected := true; end;
  if not rejected then raise exception 'confirmation replay accepted'; end if;
  select revision into rev from public.treasury_workspaces where user_id = owner_id;
  if rev <> 3 then raise exception 'replay changed the workspace'; end if;
  rejected := false;
  begin perform public.hodd_apply_agent_action(gen_random_uuid(), 'TREASURY', 'UPDATE_POLICY', '{}', 'stale', 'APPLIED', null, w, 2); exception when serialization_failure then rejected := true; end;
  if not rejected then raise exception 'stale connector write accepted'; end if;
  rev := public.hodd_apply_agent_action(request_id, 'TREASURY', 'PAYMENT_REQUEST', '{"obligationId":"x"}', 'Pay rent', 'OPEN', now() + interval '1 day', w, 3);

  -- Owner reads; another user cannot; requests resolve once.
  select count(*) into n from public.agent_actions where user_id = owner_id;
  if n <> 2 then raise exception 'owner cannot read actions'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', other_id, 'role', 'authenticated', 'client_id', 'claude-test-client')::text, true);
  select count(*) into n from public.agent_actions where user_id = owner_id;
  if n <> 0 then raise exception 'cross-user read'; end if;
  rejected := false;
  begin perform public.hodd_resolve_agent_request(request_id, 'DONE'); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'cross-user resolve'; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'role', 'authenticated')::text, true);
  perform public.hodd_resolve_agent_request(request_id, 'DONE');
  rejected := false;
  begin perform public.hodd_resolve_agent_request(request_id, 'DISMISSED'); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'request resolved twice'; end if;
  rejected := false;
  begin perform public.hodd_resolve_agent_request(action_id, 'DONE'); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'applied change treated as request'; end if;
  execute 'reset role';
  raise notice 'agent action revision, connector-only writes, replay, isolation and request resolution passed';
end;
$$;
select 'agent_actions passed' as result;
rollback;
