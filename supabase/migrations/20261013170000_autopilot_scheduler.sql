-- Hourly Autopilot scheduler tick. Vercel Hobby crons run once a day, so Supabase calls the cron endpoint every hour;
-- the endpoint itself decides which agents are due (six hours since the last run, a changed policy, or a bill entering
-- its protection window or falling due). The bearer secret lives in Supabase Vault as 'autopilot_scheduler_secret'
-- (set out of band, never in git) and must equal AUTOPILOT_SCHEDULER_SECRET in the Vercel project.
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
