-- Stage 6: confirmation-handle key that needs no host configuration.
-- A random key is generated once in the database. Only connector tokens
-- (client_id claim) can read it, through a definer function. Hosts may still
-- override it with HODD_MCP_HANDLE_SECRET. A user who holds a connector token
-- could only mint confirmations for their own account and connection, which
-- the write tools already let them perform after a preview.
create table if not exists hodd_private.agent_settings (
  id boolean primary key default true check (id),
  confirmation_key text not null default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')
);
insert into hodd_private.agent_settings(id) values (true) on conflict (id) do nothing;

create or replace function public.hodd_agent_confirmation_key() returns text
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'client_id', '') = '' then raise exception 'connector token required'; end if;
  return (select confirmation_key from hodd_private.agent_settings where id);
end;
$$;
revoke all on function public.hodd_agent_confirmation_key() from public, anon;
grant execute on function public.hodd_agent_confirmation_key() to authenticated;
