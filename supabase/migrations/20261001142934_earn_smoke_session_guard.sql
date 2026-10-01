-- Stage 4 only: isolated test ledger and revoked-session detection.
create table public.earn_smoke_workspaces (
  user_id uuid primary key references auth.users(id) on delete cascade,
  schema_version integer not null check (schema_version = 4),
  workspace jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.earn_smoke_workspaces enable row level security;
revoke all on public.earn_smoke_workspaces from anon;
grant select, insert, update, delete on public.earn_smoke_workspaces to authenticated;
create policy "smoke owner select" on public.earn_smoke_workspaces for select to authenticated using ((select auth.uid()) = user_id);
create policy "smoke owner insert" on public.earn_smoke_workspaces for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "smoke owner update" on public.earn_smoke_workspaces for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "smoke owner delete" on public.earn_smoke_workspaces for delete to authenticated using ((select auth.uid()) = user_id);

-- The private helper is the only privileged lookup. It accepts no caller-supplied
-- user/session identifiers and returns no session data. Never expose auth.sessions.
create schema if not exists hodd_private;
revoke all on schema hodd_private from public, anon;
grant usage on schema hodd_private to authenticated;
create function hodd_private.earn_session_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
    and coalesce((auth.jwt()->>'is_anonymous')::boolean, false) = false
    and (auth.jwt()->>'exp')::bigint > extract(epoch from now())
    and exists (
      select 1 from auth.sessions s
      where s.id = (auth.jwt()->>'session_id')::uuid
        and s.user_id = auth.uid()
        and (s.not_after is null or s.not_after > now())
    );
$$;
revoke all on function hodd_private.earn_session_active() from public, anon;
grant execute on function hodd_private.earn_session_active() to authenticated;

create function public.hodd_earn_session_active() returns boolean
language sql stable security invoker set search_path = '' as $$
  select hodd_private.earn_session_active();
$$;
revoke all on function public.hodd_earn_session_active() from public, anon;
grant execute on function public.hodd_earn_session_active() to authenticated;
