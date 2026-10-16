-- Rollback-only synthetic fixtures. No real users or wallets.
-- 1) A stale workspace write fails once, with a code PostgREST does not retry.
--    40001 (serialization_failure) and 40P01 (deadlock) make PostgREST re-run the same
--    transaction forever: one stale browser upsert was retried ~100 times a second from
--    2026-10-15 13:36 UTC until the guard was changed.
-- 2) hodd_earn_session_active() answers false, not "permission denied", without a session,
--    while the private session lookup stays closed to anon.
begin;
do $$
declare owner_id uuid := gen_random_uuid(); session_id uuid := gen_random_uuid(); w jsonb; tbl text; code text; message text; rev bigint; answer boolean;
begin
  insert into auth.users(id, aud, role, is_sso_user, is_anonymous) values (owner_id, 'authenticated', 'authenticated', false, false);
  insert into auth.sessions(id, user_id) values (session_id, owner_id);
  w := jsonb_build_object('schemaVersion', 4, 'obligations', '[]'::jsonb, 'policy', '{}'::jsonb, 'walletConnection', null, 'pendingTransactions', jsonb_build_object('currency','USDC','decimals',6,'minorUnits','0'));
  perform set_config('request.jwt.claims', jsonb_build_object('role','service_role')::text, true);
  insert into public.treasury_workspaces(user_id, schema_version, workspace) values (owner_id, 4, w);
  insert into public.earn_smoke_workspaces(user_id, schema_version, workspace) values (owner_id, 4, w);
  -- Every revision-guarded table (including the local pilot table, where applied) shares one guard.
  if exists (select 1 from pg_trigger where tgname = 'workspace_revision_guard' and tgfoid <> 'hodd_private.workspace_revision_guard'::regproc) then raise exception 'a workspace table uses another revision guard'; end if;

  foreach tbl in array array['treasury_workspaces', 'earn_smoke_workspaces'] loop
    execute format('update public.%I set workspace = $1, revision = 0 where user_id = $2', tbl) using w, owner_id;
    execute format('select revision from public.%I where user_id = $1', tbl) into rev using owner_id;
    if rev <> 1 then raise exception '% revision did not advance: %', tbl, rev; end if;
    code := null;
    begin
      execute format('update public.%I set workspace = $1, revision = 0 where user_id = $2', tbl) using w, owner_id;
    exception when others then get stacked diagnostics code = returned_sqlstate, message = message_text;
    end;
    if code is null then raise exception '% accepted a stale revision', tbl; end if;
    if code in ('40001', '40P01') then raise exception '% conflict uses retryable SQLSTATE %; PostgREST would retry it forever', tbl, code; end if;
    if code <> 'PT409' or message <> 'workspace revision conflict' then raise exception '% conflict returned % %', tbl, code, message; end if;
    execute format('select revision from public.%I where user_id = $1', tbl) into rev using owner_id;
    if rev <> 1 then raise exception '% stale write changed the row', tbl; end if;
  end loop;

  -- Server-side writers while a tab is open: the tab saved revision 1; the Claude connector and
  -- Hoddie still hold revision 0. Each stale call fails once with PT409 and writes nothing.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'session_id', session_id, 'role', 'authenticated', 'exp', 9999999999, 'client_id', 'claude-test-client')::text, true);
  execute 'set local role authenticated';
  code := null;
  begin perform public.hodd_apply_agent_action(gen_random_uuid(), 'TREASURY', 'UPDATE_POLICY', '{}', 'stale connector write', 'APPLIED', null, w, 0);
  exception when others then get stacked diagnostics code = returned_sqlstate; end;
  if code is distinct from 'PT409' then raise exception 'stale connector write returned %', code; end if;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'session_id', session_id, 'role', 'authenticated', 'exp', 9999999999)::text, true);
  code := null;
  begin perform public.hodd_apply_hoddie_action(gen_random_uuid(), 'UPDATE_POLICY', '{}', 'stale Hoddie write', 'APPLIED', null, w, 0);
  exception when others then get stacked diagnostics code = returned_sqlstate; end;
  if code is distinct from 'PT409' then raise exception 'stale Hoddie write returned %', code; end if;
  execute 'reset role';
  select revision into rev from public.treasury_workspaces where user_id = owner_id;
  if rev <> 1 or exists (select 1 from public.agent_actions where user_id = owner_id) then raise exception 'a stale server write changed the workspace'; end if;
  -- After reloading the current revision the connector write applies once.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'session_id', session_id, 'role', 'authenticated', 'exp', 9999999999, 'client_id', 'claude-test-client')::text, true);
  execute 'set local role authenticated';
  rev := public.hodd_apply_agent_action(gen_random_uuid(), 'TREASURY', 'UPDATE_POLICY', '{}', 'current connector write', 'APPLIED', null, w, 1);
  if rev <> 2 then raise exception 'current connector write revision %', rev; end if;
  execute 'reset role';

  -- Grants: only the public wrapper is callable without a session; the private lookup is not.
  if has_function_privilege('anon', 'hodd_private.earn_session_active()', 'execute') or has_schema_privilege('anon', 'hodd_private', 'usage') then raise exception 'anon can reach the private session lookup'; end if;
  if not has_function_privilege('anon', 'public.hodd_earn_session_active()', 'execute') then raise exception 'anon cannot ask whether a session is active'; end if;
  if not has_function_privilege('authenticated', 'public.hodd_earn_session_active()', 'execute') then raise exception 'authenticated lost the session check'; end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a where p.oid = 'public.hodd_earn_session_active()'::regprocedure and a.grantee = 0) then raise exception 'PUBLIC can execute the session check'; end if;

  -- No session (anon): false, no 42501.
  perform set_config('request.jwt.claims', jsonb_build_object('role','anon')::text, true);
  execute 'set local role anon';
  answer := public.hodd_earn_session_active();
  if answer is distinct from false then raise exception 'anon session check returned %', answer; end if;
  execute 'reset role';

  -- Server key without a user: false, no error.
  perform set_config('request.jwt.claims', jsonb_build_object('role','service_role')::text, true);
  execute 'set local role service_role';
  answer := public.hodd_earn_session_active();
  if answer is distinct from false then raise exception 'service_role session check returned %', answer; end if;
  execute 'reset role';

  -- Signed-in owner with a live session: true. Revoked session: false.
  perform set_config('request.jwt.claims', jsonb_build_object('sub', owner_id, 'session_id', session_id, 'role', 'authenticated', 'exp', 9999999999)::text, true);
  execute 'set local role authenticated';
  if not public.hodd_earn_session_active() then raise exception 'valid session rejected'; end if;
  execute 'reset role';
  delete from auth.sessions where id = session_id;
  execute 'set local role authenticated';
  if public.hodd_earn_session_active() then raise exception 'revoked session accepted'; end if;
  execute 'reset role';
end $$;
select true as workspace_conflict_assertions_passed;
rollback;
