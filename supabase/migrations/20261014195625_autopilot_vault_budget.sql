-- Vault mode: the mandate's budget only records what the owner put into Autopilot; it no longer limits the agent
-- (the vault contract limits where money can go). Raise the stored ceiling from 1,000 USDC to the app's
-- AGENT_MAX_BUDGET_MINOR (1 billion USDC, 6 decimals).
alter table public.agent_mandates drop constraint agent_mandates_mandate_check;
alter table public.agent_mandates add constraint agent_mandates_mandate_check
  check ((mandate->>'budgetMinor')::numeric between 1 and 1000000000000000);
