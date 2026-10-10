# Autopilot validation

Autopilot lets a user give a separate **Circle developer-controlled wallet** (one EOA per user on `ARC-TESTNET`, created idempotently in the wallet set "Hodd Autopilot Testnet") a budget. Hodd's deterministic engine decides every amount (`src/lib/autopilot/decision.ts`); the agent signs server-side through Circle, and can only reach:

- the allowlisted Morpho vault through the Earn Kit router (`validateEarnCall` + `validateAgentEarnCall`), and
- canonical Arc USDC transfers to the owner's proven wallet (`assertAgentDestination`).

## Live custody smoke (Arc Testnet, 2026-10-10)

`HODD_AUTOPILOT_LIVE=1 pnpm vitest run src/lib/autopilot/autopilot.live.test.ts` uses the runner's own quote, capture, validation, destination and receipt code with a real Circle wallet (Supabase bookkeeping is skipped). The owner is the dev test signer `0xB7a07a8184412A160bACe9DA3EeC914c0021a19C`.

| Step | Evidence |
| --- | --- |
| Wallet set / agent wallet (idempotent, same id on re-create) | set `3c2826ec-e4fb-5b44-8610-223296cb1a3f`, wallet `3eb0425b-e815-5d61-ae56-7538da51f8e2`, address `0xe6233b6946248494f71a48eb4c5a02479aa48920` |
| Fund 1 USDC from the owner | `0x558c4f4acad64d450725a8451f6537312bf1bc096a8776d48722699432a08501` |
| Morpho deposit 0.5 USDC (approval, router) | `0x9630af34f75b3d086af74cd04cc247540a3ff09e79c6e03eb5d956aa0223b45d`, `0xcd007d73e55fee6abbe09a40bd6ff5fe030059f03ad6edfd67b4b7f0ec7eb217` |
| Morpho withdraw 0.499 USDC (share approval, router) | `0x6b73d7ead2bfec2df6fa5080eabefa18170eb29b21159d320f442f574a72a204`, `0x5f3d4f5a6562ea50287053f4edef2f8c081eda77864777c0f83e74fef4eb1488` |
| Return 0.972674 USDC to the owner | `0x5ec1689e8a6fc72f3ecd6d4a191c968d0f40737903a960623b806dcb92d673d5` |

The same flow passed in two earlier full runs (deposit `0x054a4573…`, `0x61b6408a…`; withdraw `0x21193d3f…`, `0x2082b333…`; return `0xd5239ad4…`).

## Defects found by the live run and fixed

1. **Circle rejected the agent's fee format** (`400 API parameter invalid: priorityFee too low`). Arc is EIP-1559; developer wallets need `{ type: "absolute", maxFee, priorityFee, gasLimit }`. `agentFeeConfig` now sends the approved per-gas ceiling as `maxFee` (debit stays ≤ gasLimit × ceiling) and a tip of 2× the network estimate, at least 2 gwei, never above the ceiling.
2. **Withdrawals were refused by the agent's own guard.** Earn Kit approves the whole share balance (+1) to the router and passes the whole balance as the router input, withdrawing exactly the quoted assets and sweeping the spare shares back. The guard now caps the approval and input at the wallet's share balance and requires the vault-share sweep back to the agent wallet; `validateEarnCall` still enforces `withdraw(assets) == quote` and the beneficiary rules.

## Not yet verified live

- The Supabase part (mandate review/confirm, run/step ledger, budget accounting trigger, rate limits, cron). It needs `supabase/migrations/20261010112126_agent_autopilot.sql` applied to the hosted project, which is an owner decision. `supabase/tests/agent_autopilot.sql` is the rollback-only test to run after applying it.
- Production needs `CIRCLE_ENTITY_SECRET` and `CRON_SECRET` in Vercel (Production scope), optionally `CIRCLE_AGENT_WALLET_SET_ID=3c2826ec-e4fb-5b44-8610-223296cb1a3f`, and the `AGENT` row in `hodd_live_controls` switched on after the owner's own run. Locally: `HODD_AGENT_EXECUTION_ENABLED=true` in `.env.development.local`.
