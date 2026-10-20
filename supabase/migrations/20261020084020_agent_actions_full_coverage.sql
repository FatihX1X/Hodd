-- The Claude connector covers the rest of Hodd: deleting a bill, pausing Autopilot (both applied after approval),
-- and USYC pool and Autopilot requests the user finishes in Hodd. Additive: existing rows stay valid.
alter table public.agent_actions drop constraint if exists agent_actions_kind_check;
alter table public.agent_actions add constraint agent_actions_kind_check check (kind in (
  'CREATE_OBLIGATION','UPDATE_OBLIGATION','DELETE_OBLIGATION','UPDATE_POLICY','SET_TARGETS',
  'PAYMENT_REQUEST','EARN_REQUEST','USYC_REQUEST','AUTOPILOT_REQUEST','PAUSE_AUTOPILOT'));
alter table public.agent_actions drop constraint if exists agent_actions_check;
alter table public.agent_actions add constraint agent_actions_check
  check ((kind in ('PAYMENT_REQUEST','EARN_REQUEST','USYC_REQUEST','AUTOPILOT_REQUEST')) = (status <> 'APPLIED'));

create or replace function public.hodd_resolve_agent_request(p_id uuid, p_status text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if p_status not in ('DONE','DISMISSED') then raise exception 'invalid status'; end if;
  update public.agent_actions set status = p_status, resolved_at = now()
    where id = p_id and user_id = auth.uid() and status = 'OPEN' and kind in ('PAYMENT_REQUEST','EARN_REQUEST','USYC_REQUEST','AUTOPILOT_REQUEST');
  if not found then raise exception 'request not open'; end if;
end;
$$;
