-- Non-persistent Stage 4 verification. All synthetic users, rows and sessions roll back.
begin;
select set_config('hodd.test_owner', gen_random_uuid()::text, true);
select set_config('hodd.test_other', gen_random_uuid()::text, true);
select set_config('hodd.test_session', gen_random_uuid()::text, true);
insert into auth.users(id, aud, role) values
  (current_setting('hodd.test_owner')::uuid, 'authenticated', 'authenticated'),
  (current_setting('hodd.test_other')::uuid, 'authenticated', 'authenticated');
insert into auth.sessions(id, user_id) values (current_setting('hodd.test_session')::uuid, current_setting('hodd.test_owner')::uuid);
-- Workspace writes are owner- or server-only (payment obligation sync trigger); seed fixtures as the server.
select set_config('request.jwt.claims', jsonb_build_object('role', 'service_role')::text, true);
insert into public.earn_smoke_workspaces(user_id, schema_version, workspace) values
  (current_setting('hodd.test_owner')::uuid, 4, '{"test":"owner"}'),
  (current_setting('hodd.test_other')::uuid, 4, '{"test":"other"}');
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('hodd.test_owner'), 'session_id', current_setting('hodd.test_session'), 'role', 'authenticated', 'exp', 9999999999)::text, true);
set local role authenticated;
do $$ begin
  if (select count(*) from public.earn_smoke_workspaces) <> 1 then raise exception 'Owner row isolation failed'; end if;
  if not public.hodd_earn_session_active() then raise exception 'Valid session was rejected'; end if;
end $$;
with changed as (update public.earn_smoke_workspaces set workspace = '{"test":"forbidden"}' where user_id = current_setting('hodd.test_other')::uuid returning user_id)
select set_config('hodd.cross_update_rejected', (count(*) = 0)::text, true) from changed;
do $$ begin
  begin
    insert into public.earn_smoke_workspaces(user_id, schema_version, workspace) values (current_setting('hodd.test_other')::uuid, 4, '{}');
    raise exception 'Cross-owner insert unexpectedly succeeded';
  -- RLS or the earlier owner-sync trigger may reject it; either proves isolation.
  exception
    when insufficient_privilege then null;
    when raise_exception then if sqlerrm <> 'owner required' then raise; end if;
  end;
end $$;
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('hodd.test_other'), 'session_id', current_setting('hodd.test_session'), 'role', 'authenticated', 'exp', 9999999999)::text, true);
do $$ begin if public.hodd_earn_session_active() then raise exception 'Cross-owner session accepted'; end if; end $$;
reset role;
delete from auth.sessions where id = current_setting('hodd.test_session')::uuid;
select set_config('request.jwt.claims', jsonb_build_object('sub', current_setting('hodd.test_owner'), 'session_id', current_setting('hodd.test_session'), 'role', 'authenticated', 'exp', 9999999999)::text, true);
set local role authenticated;
do $$ begin if public.hodd_earn_session_active() then raise exception 'Revoked session accepted'; end if; end $$;
select true as owner_and_session_assertions_passed, current_setting('hodd.cross_update_rejected')::boolean as cross_owner_update_rejected;
rollback;
