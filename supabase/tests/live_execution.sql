-- Rollback-only synthetic fixtures for live testnet execution. No real users or wallets.
begin;
do $$
declare
  alice uuid := gen_random_uuid(); bob uuid := gen_random_uuid();
  quote_a uuid := gen_random_uuid(); quote_b uuid := gen_random_uuid(); quote_c uuid := gen_random_uuid();
  wallet text := '0x00000000000000000000000000000000000000aa';
  w jsonb; t text; rejected boolean; n integer; lease_state text;
  quote jsonb := '{"requiresWarningAcknowledgement":false}'::jsonb;
  wallet_json jsonb := jsonb_build_object('address', '0x00000000000000000000000000000000000000AA');
  pay_id uuid := gen_random_uuid();
begin
  -- Browsers can read their own rows but never write execution state.
  foreach t in array array['public.earn_quotes','public.earn_executions','public.wallet_leases','public.earn_execution_receipts','public.wallet_ownership_proofs','public.hodd_live_controls'] loop
    if has_table_privilege('authenticated', t, 'INSERT') or has_table_privilege('authenticated', t, 'UPDATE') or has_table_privilege('authenticated', t, 'DELETE') then raise exception 'browser can write %', t; end if;
  end loop;
  if has_function_privilege('authenticated', 'public.hodd_start_earn_execution(uuid,text,uuid,text,text,boolean,jsonb,text)', 'EXECUTE') then raise exception 'browser can start executions'; end if;
  if has_function_privilege('authenticated', 'public.hodd_release_unsubmitted_payment(uuid,text,uuid,jsonb)', 'EXECUTE') then raise exception 'browser can release payments'; end if;
  if not has_table_privilege('anon', 'public.hodd_live_controls', 'SELECT') then raise exception 'controls must be public'; end if;

  insert into auth.users(id, is_sso_user, is_anonymous) values (alice, false, false), (bob, false, false);
  perform set_config('request.jwt.claims', jsonb_build_object('role','service_role')::text, true);
  insert into public.earn_quotes(id, user_id, scope, wallet_address, binding, policy_digest, quote, expires_at) values
    (quote_a, alice, 'TREASURY', wallet, 'bind-a', 'digest-a', quote, now() + interval '5 minutes'),
    (quote_b, bob, 'TREASURY', wallet, 'bind-b', 'digest-b', quote, now() + interval '5 minutes'),
    (quote_c, alice, 'TREASURY', wallet, 'bind-a', 'digest-a', quote, now() - interval '1 minute');

  -- A quote is consumed once, only by its binding, only before expiry.
  rejected := false;
  begin perform public.hodd_start_earn_execution(alice, 'TREASURY', quote_a, 'bind-x', 'digest-a', false, wallet_json, '1'); exception when raise_exception then rejected := sqlerrm = 'quote not available'; end;
  if not rejected then raise exception 'foreign binding consumed a quote'; end if;
  rejected := false;
  begin perform public.hodd_start_earn_execution(alice, 'TREASURY', quote_c, 'bind-a', 'digest-a', false, wallet_json, '1'); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'expired quote consumed'; end if;
  perform public.hodd_start_earn_execution(alice, 'TREASURY', quote_a, 'bind-a', 'digest-a', false, wallet_json, '1');
  select count(*) into n from public.wallet_leases where wallet_address = wallet and holder_id = quote_a and state = 'ACTIVE';
  if n <> 1 then raise exception 'execution did not take the wallet lease'; end if;
  rejected := false;
  begin perform public.hodd_start_earn_execution(alice, 'TREASURY', quote_a, 'bind-a', 'digest-a', false, wallet_json, '1'); exception when raise_exception or unique_violation then rejected := true; end;
  if not rejected then raise exception 'quote consumed twice'; end if;

  -- Another user (or execution) cannot take a busy wallet; the quote stays unconsumed.
  rejected := false;
  begin perform public.hodd_start_earn_execution(bob, 'TREASURY', quote_b, 'bind-b', 'digest-b', false, wallet_json, '1'); exception when raise_exception then rejected := sqlerrm = 'wallet busy'; end;
  if not rejected then raise exception 'busy wallet leased twice'; end if;
  if (select consumed_at from public.earn_quotes where id = quote_b) is not null then raise exception 'rejected start consumed the quote'; end if;

  -- UNKNOWN keeps the lease; a terminal state releases it.
  update public.earn_executions set state = 'UNKNOWN' where id = quote_a;
  select state into lease_state from public.wallet_leases where holder_id = quote_a;
  if lease_state is distinct from 'UNKNOWN' then raise exception 'UNKNOWN released the lease'; end if;
  update public.earn_executions set state = 'FAILED' where id = quote_a;
  select count(*) into n from public.wallet_leases where wallet_address = wallet;
  if n <> 0 then raise exception 'terminal state kept the lease'; end if;
  perform public.hodd_start_earn_execution(bob, 'TREASURY', quote_b, 'bind-b', 'digest-b', false, wallet_json, '1');
  update public.earn_executions set state = 'COMPLETE' where id = quote_b;

  -- Payments share the same wallet lease.
  w := jsonb_build_object('schemaVersion', 4, 'obligations', jsonb_build_array(jsonb_build_object('id','bill','status','UPCOMING','revision',1)), 'policy', '{}'::jsonb, 'walletConnection', null, 'pendingTransactions', jsonb_build_object('currency','USDC','decimals',6,'minorUnits','0'));
  insert into public.treasury_workspaces(user_id, schema_version, workspace) values (alice, 4, w);
  insert into public.payment_proposals(id, user_id, scope, obligation_id, wallet_address, binding, policy_digest, policy_snapshot, obligation_snapshot, pending_snapshot, proposal, expires_at)
    values (pay_id, alice, 'TREASURY', 'bill', wallet, 'bind-a', 'digest-a', '{}', '[]', '{}', '{"amount":{"minorUnits":"1"},"feeReserve":{"minorUnits":"1"}}', now() - interval '1 minute');
  update public.payment_proposals set state = 'AWAITING_SIGNATURE' where id = pay_id;
  select count(*) into n from public.wallet_leases where holder_id = pay_id and kind = 'PAYMENT';
  if n <> 1 then raise exception 'payment did not take the wallet lease'; end if;
  insert into public.earn_quotes(id, user_id, scope, wallet_address, binding, policy_digest, quote, expires_at) values (quote_c, alice, 'TREASURY', wallet, 'bind-a', 'digest-a', quote, now() + interval '5 minutes')
    on conflict (id) do update set expires_at = excluded.expires_at, consumed_at = null;
  rejected := false;
  begin perform public.hodd_start_earn_execution(alice, 'TREASURY', quote_c, 'bind-a', 'digest-a', false, wallet_json, '1'); exception when raise_exception then rejected := sqlerrm = 'wallet busy'; end;
  if not rejected then raise exception 'Earn ran while a payment held the wallet'; end if;

  -- An expired, never-submitted payment releases only with a proof.
  rejected := false;
  begin perform public.hodd_release_unsubmitted_payment(alice, 'TREASURY', pay_id, null); exception when raise_exception then rejected := true; end;
  if not rejected then raise exception 'released without proof'; end if;
  perform public.hodd_release_unsubmitted_payment(alice, 'TREASURY', pay_id, '{"kind":"EOA_NONCE","nonce":"4"}');
  if (select state from public.payment_proposals where id = pay_id) <> 'EXPIRED' then raise exception 'release did not expire the payment'; end if;
  select count(*) into n from public.wallet_leases where holder_id = pay_id;
  if n <> 0 then raise exception 'release kept the lease'; end if;

  -- Obligations without payment history can be removed; with history they cannot.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', alice, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  rejected := false;
  begin update public.treasury_workspaces set workspace = jsonb_set(w, '{obligations}', '[]'::jsonb) where user_id = alice; exception when raise_exception then rejected := sqlerrm = 'obligation deletion is not supported'; end;
  if not rejected then raise exception 'deleted an obligation with payment history'; end if;
  update public.treasury_workspaces set workspace = jsonb_set(w, '{obligations}', w->'obligations' || jsonb_build_array(jsonb_build_object('id','draft','status','DRAFT','revision',1))) where user_id = alice;
  update public.treasury_workspaces set workspace = jsonb_set(w, '{obligations}', w->'obligations') where user_id = alice;
  select count(*) into n from public.payment_obligations where user_id = alice and id = 'draft';
  if n <> 0 then raise exception 'history-free obligation was not removed'; end if;

  -- Owners read only their own rows.
  select count(*) into n from public.earn_executions;
  if n <> 1 then raise exception 'owner read % executions', n; end if;
  select count(*) into n from public.wallet_leases;
  if n <> 0 then raise exception 'unexpected lease visibility'; end if;

  -- Usage limits trip per user and kind, and need an active session.
  rejected := false;
  begin perform public.hodd_reserve_live_usage('START'); exception when raise_exception then rejected := sqlerrm = 'active session required'; end;
  if not rejected then raise exception 'usage reserved without an active session'; end if;
end;
$$;
rollback;
