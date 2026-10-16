-- Autopilot vault mode: the user's HoddieVault (owner = the user's wallet, operator = the Circle agent wallet) holds
-- the funds. The server records the vault only after reading its owner, operator, limits and strategies on-chain.
alter table public.agent_wallets add column vault_address text unique check (vault_address ~ '^0x[0-9a-f]{40}$');

-- Operator calls on the vault (deposit, withdraw, redeem to owner, transfer to owner, pay an approved recipient).
-- The step accounting trigger counts only their network fee: the USDC stays in the vault, goes to the owner, or pays
-- a bill through the payment ledger.
alter table public.agent_run_steps drop constraint agent_run_steps_stage_check;
alter table public.agent_run_steps add constraint agent_run_steps_stage_check check (stage in ('APPROVAL','EARN','TRANSFER','VAULT'));
