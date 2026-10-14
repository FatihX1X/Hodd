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

## Production return-all (2026-10-11)

The owner's return stalled as `UNKNOWN / AGENT_RECEIPT_NOT_VERIFIED` although Arc confirmed it (`0x6be5253ae2e0ddc462a8cb685a0e141aba6a1bb923001ef4bff47bad76722c88`). The withdrawal was quoted at Circle's rounded maximum (7.969328 USDC) and routed as a full exit, so the vault paid 7.969330; the receipt check required the exact quote. `verifyEarnReceipt` now accepts up to 0.01% (min 100 units) above a WITHDRAW quote only when the router burned every share it pulled and swept none back; a partial withdrawal stays exact. The live receipt is the regression fixture `src/test/arc-withdraw-full-exit.json`.

Return all is now one run (withdraw, then transfer of all cash minus that transfer's gas ceiling to the verified owner) and is not limited by the budget or the per-run cap, since the only destination is the owner. Earlier it needed several capped runs five minutes apart.

## Not yet verified live

- The Supabase migration is applied to the hosted project as version `20261010121212` (2026-10-10) and `supabase/tests/agent_autopilot.sql` passed there in a rolled-back transaction (owner isolation, browser write denial, server-only RPCs, one open run, lease, cross-owner step rejection, budget accounting once per verified step, AGENT off). A full signed-in run through the routes (mandate review/confirm, Run now, cron) still waits for the owner.
- Production needs `CIRCLE_ENTITY_SECRET` and `CRON_SECRET` in Vercel (Production scope), optionally `CIRCLE_AGENT_WALLET_SET_ID=3c2826ec-e4fb-5b44-8610-223296cb1a3f`, and the `AGENT` row in `hodd_live_controls` switched on after the owner's own run. Locally: `HODD_AGENT_EXECUTION_ENABLED=true` in `.env.development.local`.

## Vault mode, live lifecycle (Arc Testnet, 2026-10-14)

HoddieVaultFactory `0x311578B21F269ca0E45f5c16324A3E51f69ce389`. Owner: dev test signer `0xB7a0…a19C`. Operator: Circle developer-controlled wallet `0xe6233b6946248494F71a48Eb4c5a02479AA48920`. Vault: `0x4cE19EAbc6F38fb95030E400A50abac0f4f12B88`. Run with `HODD_VAULT_LIVE=1 corepack pnpm exec vitest run src/lib/autopilot/vault.live.test.ts --silent=false`. Every agent call was encoded, decoded and receipt-verified with the runner's own functions.

| Step | Who | Transaction | Result |
| --- | --- | --- | --- |
| createVault through the factory | owner | `0x2d4cdde99fb7aae6ee74eb7faa3fe544ef5e2a27c520ad670f6eb7647bc89fbf` | 3,329,045 gas; owner, operator, limits and strategies read back exactly |
| Fund 1 USDC, agent fee money, approve recipient (cap 0.1) | owner | `0x69e7…a5fc`, `0x0aea…d2a0`, `0xa244…a6a` | |
| depositToStrategy 0.5 USDC | agent | `0xccb84eeb77f504a9ad3af3d9f5825b236cd439085ce5b7c379157909c8285113` | 499,471,378,035,713,212 shares |
| withdrawFromStrategy 0.2 USDC | agent | `0xbe6fb7c2fb26311708dd68c62b85efdc4f29565bf5ac16b3f606ab761933ea9d` | |
| pay 0.1 USDC to the approved recipient | agent | `0x6f252005839251353d689cc8300f66ff73bbe1b51e52c14aeee238d104aa6a01` | recipient +0.1 USDC, Transfer at log index 5 |
| pay over the cap; pay to an unknown address | agent | (simulated) | both refused by the contract |
| redeemToOwner (half the shares) | agent | `0x95ff6b6afad5001d4be8103691bd251ea0974bc13f40fe0148a393abb4cbfe9b` | 0.149999 USDC to the owner |
| transferToOwner 0.1 USDC | agent | `0x9168c204ff125c48a0c0cbc7666261196c2bbfb02dad155937cc459c6f91cd82` | |
| withdrawAll | owner | `0x55aacabe69e7a109f39f15a1ebe839999954cc5846af2a339c87a0423caab3ef` | vault cash 0, position 0 |

The ledger path for a vault bill payment was checked against the production database in a transaction that was rolled back:
- opening the payment takes the vault's lease;
- a second payment for the same bill is refused;
- workspace edits are blocked while the payment is open;
- `hodd_finish_payment` marks the proposal CONFIRMED and the bill PAID with the proposal as its reference, and releases the lease.

## Production account moved into its vault (2026-10-14)

The owner's live account had used the custodial agent: the agent wallet `0xae40…750b` held 20.03 USDC and a Morpho position worth 19.96 USDC. Steps:
1. **Vault created.** The owner's vault was created through the factory (permissionless; owner = the owner's wallet `0xdef0…2e7c`, operator = the agent). Tx `0x7c7199e80c96eeb2f7d6f364d3a1fec539a2a30336a70fa30a9f03029d800e87`, vault `0xA425dD0ACC673405E648EBe64eED2fC4Da0AD02d`.
2. **Vault checked and registered.** Its owner, operator, asset, limits and strategies were read back on-chain, then the vault was registered on the account.
3. **First run started.** The production scheduler started the first vault-mode run (trigger FIRST_RUN). It decided MOVE_TO_VAULT and completed two verified steps:
   - the agent's Morpho shares moved to the vault, tx `0x58af220ca9dd5906679dea3969c79a971898cf70c60da58645de205a2128e276`;
   - 19.523539 USDC moved to the vault, tx `0x68a0751a2160d9b2a3d19126d223b45ee1f993b579dd3de555fc096894a7dda3`.

After the run, the vault held 19.523539 USDC cash plus 19.963245 USDC in Morpho. The agent kept 0.498531 USDC for network fees.

An owner MetaMask payment for the account's 2 USDC bill (`1bed6922…`, 2026-10-13) had been left UNKNOWN with no hash. While it stayed open, the ledger could not mark any bill PAID, so Autopilot paid nothing. Its prepared nonce, 62, was then used by the owner's 30 USDC Autopilot funding transfer `0xc69f43b23add5999b6aa7697ab37eba0a7167b4a909052f772d32e9943614dcf` (block 67127988): the owner's nonce was 62 at block 67127987 and 63 at block 67127988. A transaction prepared with nonce 62 can therefore never be included.

Recovery used to accept only an unchanged nonce, so this payment could never be released. It now also accepts this proof (`EOA_NONCE_CONSUMED`, `src/lib/payments/nonce-proof.ts`). The payment was released through `hodd_release_unsubmitted_payment` with that proof stored on the record.
