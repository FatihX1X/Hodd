# Hodd

Hodd is a liquidity-first treasury console for individuals and small businesses on Arc Testnet.

The wallet ownership update adds user choice: Circle Embedded (Hodd email/Google sign-in plus Circle PIN), Circle Passkey (WebAuthn), or an existing MetaMask/Rabby wallet. One selected wallet is authoritative at a time. Funds remain in that wallet; balances are never pooled into the previous developer-controlled treasury.

## Current capabilities

- Deterministic Treasury Engine with integer minor-unit arithmetic, obligations, policy and allocation previews.
- Workspace schema v4; migration preserves policy and obligations while disconnecting legacy shared wallets.
- Public Arc Testnet USDC and ERC-4626 Morpho position reads for any selected wallet.
- Circle App Kit vault discovery, canonical USDC and a verified vault allowlist.
- Supabase SSR email/Google authentication and owner-scoped workspace persistence.
- Guest and authenticated local caches use separate keys. Account changes clear the in-memory signer.
- Supabase RLS limits each user to their own rows. A server-only secret key writes verified payment/evidence records; browser clients cannot write them.

Stage 4 adds local-only, user-approved Earn execution. The server loads the authenticated owner's persisted policy and obligations, reads fresh wallet balances and vault positions, and creates a five-minute quote. Client-supplied policy limits and wallet overrides are rejected. Quote confirmation is separate from the provider signature. Approval, UserOperation submission and verified Arc receipts are distinct events.

**Live signing verification is still pending for every provider. Stage 4 is not declared complete.** Automated mocks do not prove that Circle sponsorship, PIN challenges or browser-wallet execution are configured correctly. Unsupported/unavailable providers fail closed. Legacy developer-wallet signing code is not used.

## Setup

```bash
pnpm install
pnpm dev
```

Copy `.env.example` to git-ignored `.env.local`. Configure:

- `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` from your Supabase project.
- `CIRCLE_API_KEY` as a server-only Circle testnet API key for user-controlled wallet sessions.
- `NEXT_PUBLIC_CIRCLE_APP_ID` from Circle User-Controlled Wallet configuration.
- `NEXT_PUBLIC_CLIENT_KEY` from Circle Modular Wallet Client Keys, restricted to the intended domain.
- `NEXT_PUBLIC_CLIENT_URL` defaults to the official Modular RPC endpoint.
- `HODD_EARN_EXECUTION_ENABLED=true` enables execution only under `next dev`, on loopback, with a matching Origin and JSON request. Production and Vercel reject execution even when this flag is set.

An entity secret, private key or seed phrase is not required for these user-owned wallet choices. End users connect through the browser, PIN or passkey; they do not run Circle CLI.

The Hodd Supabase project is provisioned in Frankfurt (`eu-central-1`) on the Free plan. Apply migrations in `supabase/migrations`, including `20261001142934_earn_smoke_session_guard.sql`. Owner RLS protects the main and smoke workspaces. The Earn session guard checks the JWT owner against an active `auth.sessions` row, including expiry/revocation. `supabase/tests/earn-isolation.sql` verifies cross-owner access and revoked-session rejection in a rolled-back transaction. The advisor currently reports disabled leaked-password protection; it is not silently enabled or represented as a clean advisory report.

Enable Email Auth and optionally Google, and allow `/auth/callback` for your local/hosted origins. For SSR email confirmation use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` in the Supabase email template. Set Site URL to the intended app origin. Google OAuth uses `/auth/callback`. The schema explicitly grants authenticated Data API access and enables owner RLS.

In Circle Console configure the User-Controlled Wallet App ID, Modular Client Key and Passkey Domain. Passkeys are bound to that domain. Sessions are deliberately memory-only and require reconnecting after refresh. Recovery is managed through the wallet provider; no private keys or PINs are stored in the workspace.

For passkey execution, Hodd requires the official Gas Station paymaster. [Circle's current transfer guide](https://developers.circle.com/wallets/modular/transfer-tokens) says Arc Testnet sponsorship is automatic; a Console policy is required for mainnet, which Hodd does not enable. Hodd refuses any unsponsored/paid-paymaster fallback. Embedded execution uses the official User-Controlled Wallet server adapter; the browser SDK presents the PIN challenge. MetaMask/Rabby verify the selected account and Arc Testnet before each single-call transaction. Logout, reconnect, expiry and account/network changes invalidate the in-memory signer; quotes are bound to the original authenticated session, selected wallet, scope and policy snapshot.

For hosting, configure environment variables in the host project. `.env.local` stays on your machine. Public-prefixed configuration is included in the browser bundle; the Circle API key stays server-side. This change does not deploy the application.

## Persistence

Guests use a local demo workspace. Signed-in users load their own cloud record and a separate local cache. Changes are saved locally first and synchronized to Supabase; a visible message reports failed sync. Offline edits can be restored from the same account's cache. Ordinary workspace fields use last-write-wins; Stage 5 obligation revision checks reject conflicting edits, and pending payments lock financial mutations. Local activity is not a tamper-proof audit ledger. Wallet addresses are public metadata, not proof of wallet ownership for server authorization.

## Financial rules

```text
protected capital = obligations within 30 days + safety buffer + pending transactions
deployable capital = max(total treasury - protected capital, 0)
```

Draft/paid obligations are excluded. Active overdue obligations are included. APY is for display only. Morpho redeemable liquidity is the minimum of position value, `maxWithdraw` and vault liquidity. Public reads use one block per position. Missing/stale positions contribute no redeemable liquidity and are labeled unavailable. P&L is unavailable without principal history.

Arc Testnet chain ID is `5042002`; canonical 6-decimal USDC is `0x3600000000000000000000000000000000000000`. The native gas and ERC-20 views represent one economic USDC balance and are counted once.

Deposit plus fee reserve must fit deployable capital, liquid funds and the Morpho strategy cap while preserving obligations, safety buffer and minimum coverage. Withdrawal/redeem is bounded by fresh position value, max withdrawal and vault liquidity, not the allocation cap. Missing gas estimates or stale/unavailable data block execution. Earn quotes reserve a 20% integer gas margin for each reported step, with a bounded gas price and Arc's 20 Gwei floor; native 18-decimal fee reserves round up to 6-decimal USDC. At signing, the server simulates the exact pending call and binds its gas limit and price to the quote. Browser wallets receive those explicit ceilings, so the browser does not need a separate public RPC gas simulation. A fresh estimate or price above the quote stops before the wallet signature request. APY never determines amounts.

## Local execution and recovery

Circle PIN/SCA Earn currently fails closed with `SCA_FEE_CEILING_UNSUPPORTED` before quote creation and again before execution (including older quotes). Circle UCW requires `feeLevel` for SCA transactions (SDK error 155232); an estimate does not enforce Hodd's approved maximum fee reserve. Hodd does not send incompatible absolute SCA fees or silently fall back to unbounded fee levels. Verified pre-signing sponsorship support is required to enable this provider; Console configuration alone is not treated as proof. Existing wallet balances, PIN access and read-only positions remain available. This provider's live Earn acceptance is not complete. See [Circle contract execution](https://developers.circle.com/api-reference/wallets/user-controlled-wallets/create-user-transaction-contract-execution-challenge) and [Gas Station](https://developers.circle.com/wallets/gas-station).

Quotes and atomic consumption markers are stored in git-ignored `.hodd-local/quotes`. A per-wallet execution lease prevents overlapping quotes from spending the same wallet. Live jobs run in the development server process. A server restart does not replay consumed quotes; uncertain executions keep their lease and require manual review. Do not delete these files as a retry mechanism.

Injected-wallet account/network/gas checks run before the transaction API is invoked. A typed, sanitized preflight failure cancels that signature request without marking a submission; ambiguous errors after the transaction API boundary retain UNKNOWN and the lease. Failed confirmations disable the consumed quote in the dialog. Legacy leases require explicit user history review and fresh chain checks; a reviewed lease can be archived locally without removing its quote consumption marker. No automatic retry or blanket stale-lock cleanup is performed.

After a timeout or ambiguous error, inspect the displayed transaction/UserOperation hash in ArcScan and the wallet provider. Re-read the wallet balance, position and approvals before requesting anything else. Hodd never retries an uncertain submit automatically. A successful receipt must match the vault, operation, exact assets and receiving wallet; redeem-all with residual shares is `PARTIAL`, with no automatic second withdrawal. Local activity is not immutable proof; only verified receipt events are labeled onchain confirmation.

Use **Open isolated smoke workspace** after sign-in. It has a separate owner-scoped database row and local cache, no obligations, a 1 USDC safety buffer and the normal strategy cap/coverage rules. The server rejects the main treasury's connected wallet in smoke scope. Connect a separate test wallet, fund it sufficiently for the buffer, fees and cap, then explicitly approve at most 1 USDC deposit, a partial withdrawal and redeem-all. The server also enforces the smoke deposit limit. Main obligations and policy are never replaced. Returning to the main workspace clears the signer and requires reconnecting.

Wallet recovery belongs to the provider, not Hodd: retain access to the passkey's device/sync or backup mechanism; configure Circle Embedded recovery through Circle's supported PIN/recovery flow; use MetaMask/Rabby's own backup procedures outside Hodd. Hodd cannot export a private key or recover funds with a Supabase login. Never send a seed phrase, private key, PIN or entity secret to Hodd or chat. Wallet addresses in the workspace are public metadata, not recovery material.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm test:e2e
pnpm audit --prod
```

Live authentication, passkey/PIN provisioning, database RLS and wallet execution require configured projects and provider settings. Automated tests use mocks for provider APIs.

Dependency audit (2026-10-06): patched `undici`, `uuid`, `@grpc/grpc-js`, `source-map-js` (1.2.2) and `sharp` (0.35.5) transitives. No high/critical advisories remain. One low-severity [elliptic advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84) remains through Circle/Ethers dependencies; the registry's latest release is still 6.6.1 and no patched release is published. Audit does not currently pass cleanly.

Supabase security advisor reports the existing [leaked-password protection setting](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) as disabled. The payment migrations introduced no additional security-advisor finding. Current automated checkpoint (2026-10-07): strict typecheck/lint/build passed, 139 Vitest tests and 26 desktop/mobile Playwright checks passed; production payment routes are tested closed even with execution flags set. Client static bundles were scanned for configured server credential values without printing those values; no matches were found. Both payment ledger and evidence/recovery SQL tests passed in rolled-back transactions against the configured project.

Live preflight exposed a browser-only SDK transport (`window is not defined`) on the server. The server now uses a Node-safe Circle RPC transport with fixed localhost application metadata, an explicit read/estimation method allowlist, no redirects and no automatic retries. Signing, submission and recovery writes are denied by the transport. A real read-only preflight returned HTTP 200 and Arc Testnet chain ID 5042002. This verifies server connectivity, not user signing or payment execution; those acceptance tests still require the user-owned test wallet.

## Next work

Complete the three-provider live testnet verification before declaring Stage 4 complete. Stage 5 is in progress; it is not a completed payment product. Deployment remains out of scope. Financial calculations and amounts remain deterministic. Real integrations must follow current [Arc](https://docs.arc.io/), [Circle](https://developers.circle.com/wallets) and [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client) documentation.

## Stage 5 payment implementation status

Single-obligation, full-amount Arc Testnet USDC payment review uses server-owned policy inputs, fresh balances/positions and integer fee reserves. It does not use investment deployable capital as a payment limit. Earlier obligations, safety buffer, pending reservations and post-payment coverage must remain protected. Pending payments replace their protected obligation with amount + fee reserve, rather than double-counting the same obligation.

The payment ledger migration introduces owner-readable, server-written obligations and proposals, revision checks, atomic five-minute proposal claims, unique active wallet/obligation constraints and unique confirmed receipt references. Only server-verified canonical USDC Transfer evidence may finalize PAID. Browser activity remains local audit, not payment proof. Additive workspace fields preserve existing obligations/policy and schema-v4 caches.

`SUPABASE_SECRET_KEY` belongs only in git-ignored `.env.local` and server-only code. No entity secret or private key is required. `HODD_PAYMENT_EXECUTION_ENABLED=true` is insufficient on its own: the selected wallet/provider must have verified Stage 4 smoke receipt evidence. Production/Vercel, non-loopback hosts and mismatched origins remain closed. The job supports EOA, Circle PIN and sponsored Circle Passkey signing, but each remains gated by actual receipt evidence. The live acceptance requirement is **not yet satisfied**.

`WalletFeeQuote` binds provider, wallet, Arc chain, operation digest and five-minute expiry. EOA uses a bounded Arc gas limit/price. PIN uses Circle's official `estimateContractExecutionFee` and enforces an absolute gas limit/max fee/priority fee on the challenge. Neither assumes sponsorship. Passkey server-side estimation uses only public credential ID/key and the SDK's estimation stub; it includes deployment, call, verification, pre-verification and paymaster gas. Only the [official Arc Gas Station address](https://developers.circle.com/wallets/gas-station/contract-addresses) qualifies as sponsored. The browser signs the exact quoted operation with its actual passkey; an estimation stub is never submitted. Reconnect existing passkey sessions to add this public metadata. No raw authenticator credential or signature is persisted.

`earn_provider_evidence` records server-verified smoke operations and SDK versions. Readiness re-reads real Arc receipts for this owner/wallet/provider, requires an allowlisted vault, ordered deposit (at most 1 USDC), partial withdrawal and redemption with no residual shares. Hand-entered flags and the old `wallet_provider_verifications` table do not enable execution. Evidence-table writes are server-only and owner reads use RLS. A `PARTIAL` redemption is not accepted as complete provider verification.

Payment and Earn share a durable per-wallet lease. Once a signing request is exposed, an uncertain outcome keeps its reservation and lease even if the browser reports cancellation. Known hashes can be rechecked without sending a new transaction. Do not remove `.hodd-local` leases to retry. Receipt network fees are not represented as a sponsored wallet's actual debit.

PIN approval acknowledgment, Circle-observed approval, UserOperation hash, transaction submission and confirmed receipt are distinct. A UserOperation receipt must match the original account, nonce, exact calldata, factory, paymaster and approved gas ceilings. An outer transaction succeeding does not imply its UserOperation succeeded. Receipt recovery can resolve an existing UserOperation hash without sending anything. Verified EOA or passkey reverts atomically release the reservation but leave the obligation active; missing/ambiguous proof holds the lease. A lost claim response cannot release a lease until the ledger confirms cancellation. The UI refreshes PAID, reservations, Portfolio inputs and Activity from canonical cloud facts without re-uploading stale ledger data.

The ledger and state-audit migrations are applied. Rollback-only synthetic database tests cover owner isolation, browser write denial, PAID forgery, single-use claims, pending reservations and release. Automated jobs/routes test EOA signing orchestration, replay, parallel wallet leases, uncertain outcomes and environment guards. The UI reads owner-scoped server payment history and separates LOCAL AUDIT from ONCHAIN RECEIPT events. A newer local cache cannot revert a confirmed PAID record or override server reservations.

Apply all migrations, including `20261006151235_payment_provider_evidence_recovery.sql` and `20261006153410_payment_user_operation_receipt.sql`. Rollback-only `supabase/tests/payment_evidence_recovery.sql` additionally verifies evidence owner isolation/browser write denial, UNKNOWN retention, stale/cross-user failure rejection and EOA/UserOperation failure release without PAID.

Outstanding acceptance work: register real Stage 4 smoke receipt evidence, complete live payment smoke tests of at most 1 USDC to a user-owned test recipient for each enabled signer (Circle PIN, Circle Passkey, MetaMask and Rabby), and compare receipts, balances, positions and canonical records on real sessions. All current automated provider tests are mocks. No live payment has been performed by this checkpoint. Stage 6 MCP/OAuth/agent implementation and deployment do not start until Stage 5 technical **and live** acceptance pass. No OpenAI/Anthropic API key, private key, PIN, seed phrase or entity secret is needed for this verification.

MIT — see [LICENSE](./LICENSE).
