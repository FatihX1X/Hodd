-- Trusted state transitions are distinct from browser-authored activity.
create table public.payment_events (
  id bigint generated always as identity primary key,
  proposal_id uuid not null references public.payment_proposals(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  scope text not null check(scope in ('TREASURY','SMOKE_TEST')),
  stage text not null, kind text not null check(kind in ('LOCAL_AUDIT','ONCHAIN_RECEIPT')),
  tx_hash text, occurred_at timestamptz not null default now()
);
create index payment_events_owner_scope on public.payment_events(user_id,scope,occurred_at desc);
alter table public.payment_events enable row level security;
revoke all on public.payment_events from public,anon,authenticated;
grant select on public.payment_events to authenticated;
grant all on public.payment_events to service_role;
grant usage,select on sequence public.payment_events_id_seq to service_role;
create policy "owner reads payment events" on public.payment_events for select to authenticated using((select auth.uid())=user_id);
create function hodd_private.record_payment_transition() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
  if tg_op='INSERT' or new.state is distinct from old.state then
    insert into public.payment_events(proposal_id,user_id,scope,stage,kind,tx_hash)
    values(new.id,new.user_id,new.scope,new.state,case when new.state='CONFIRMED' then 'ONCHAIN_RECEIPT' else 'LOCAL_AUDIT' end,new.tx_hash);
  end if;
  return new;
end;
$$;
revoke all on function hodd_private.record_payment_transition() from public,anon,authenticated;
grant execute on function hodd_private.record_payment_transition() to service_role;
create trigger payment_state_audit after insert or update on public.payment_proposals for each row execute function hodd_private.record_payment_transition();
