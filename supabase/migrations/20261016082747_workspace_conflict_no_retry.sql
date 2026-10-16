-- 1) A stale workspace write must fail exactly once.
--    SQLSTATE 40001 (serialization_failure) tells PostgREST the transaction may succeed if
--    re-run, so it retries it without limit. A stale revision never becomes current, so one
--    browser upsert from a local pilot run was retried ~100 times a second from
--    2026-10-15 13:36 UTC (6.7 million errors on one connection). The same applied to the
--    Claude connector and Hoddie RPCs, which write through this trigger. PostgREST does not
--    retry PT409; it returns HTTP 409 with the same message, which every client already matches.
create or replace function hodd_private.workspace_revision_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.revision is distinct from old.revision then
    raise exception 'workspace revision conflict' using errcode = 'PT409';
  end if;
  new.revision := old.revision + 1;
  return new;
end;
$$;

-- 2) Server routes ask hodd_earn_session_active() on behalf of whoever sent the request.
--    Without a signed-in session that request runs as anon, which had no EXECUTE and logged
--    "permission denied" (42501) instead of answering false. anon may now call only this
--    wrapper, which answers false before reaching the private auth.sessions lookup; the
--    hodd_private schema and earn_session_active() stay authenticated-only.
create or replace function public.hodd_earn_session_active() returns boolean
language plpgsql stable security invoker set search_path = '' as $$
begin
  if auth.uid() is null then return false; end if;
  return hodd_private.earn_session_active();
end;
$$;
revoke all on function public.hodd_earn_session_active() from public;
grant execute on function public.hodd_earn_session_active() to anon, authenticated, service_role;
