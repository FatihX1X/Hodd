-- Hourly Autopilot scheduler tick. Vercel Hobby crons run once a day, so Supabase calls the cron endpoint every hour;
-- the endpoint itself decides which agents are due (six hours since the last run, a changed policy, or a bill entering
-- its protection window or falling due). The bearer secret lives in Supabase Vault as 'autopilot_scheduler_secret'
-- (generated in the database, never in git); the server reads the same secret through hodd_autopilot_secret below.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('hodd-autopilot-tick') where exists (select 1 from cron.job where jobname = 'hodd-autopilot-tick');
select cron.schedule('hodd-autopilot-tick', '7 * * * *', $$
  select net.http_get(
    url := 'https://app.hoddfinance.xyz/api/autopilot/cron',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'autopilot_scheduler_secret')),
    timeout_milliseconds := 60000
  );
$$);

-- Autopilot secrets for the server (service role only): the Groq key and the scheduler's bearer secret, stored in
-- Vault and set out of band. An environment variable on the server takes precedence.
create or replace function public.hodd_autopilot_secret(p_name text) returns text
language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets
  where p_name in ('groq_api_key', 'autopilot_scheduler_secret') and name = p_name
  limit 1;
$$;
revoke all on function public.hodd_autopilot_secret(text) from public, anon, authenticated;
grant execute on function public.hodd_autopilot_secret(text) to service_role;
