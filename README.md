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

Stage 4 adds user-approved Earn execution (local development, or the live testnet host described below). The server loads the authenticated owner's persisted policy and obligations, reads fresh wallet balances and vault positions, and creates a five-minute quote. Client-supplied policy limits and wallet overrides are rejected. Quote confirmation is separate from the provider signature. Approval, UserOperation submission and verified Arc receipts are distinct events.

**Rabby (EOA) live Earn verification passed on 2026-10-07; Circle Passkey and MetaMask are still pending, and Circle PIN/SCA Earn fails closed. Stage 4 is not declared complete.** Automated mocks do not prove that Circle sponsorship, PIN challenges or browser-wallet execution are configured correctly. Unsupported/unavailable providers fail closed. Legacy developer-wallet signing code is not used.

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
- `HODD_EARN_EXECUTION_ENABLED=true` / `HODD_PAYMENT_EXECUTION_ENABLED=true` enable execution under `next dev` on loopback, with a matching Origin and JSON request. Hosted builds ignore them; see **Live testnet demo**.

An entity secret, private key or seed phrase is not required for these user-owned wallet choices. End users connect through the browser, PIN or passkey; they do not run Circle CLI.

The Hodd Supabase project is provisioned in Frankfurt (`eu-central-1`) on the Free plan. Apply migrations in `supabase/migrations`, including `20261001142934_earn_smoke_session_guard.sql`. Owner RLS protects the main and smoke workspaces. The Earn session guard checks the JWT owner against an active `auth.sessions` row, including expiry/revocation. `supabase/tests/earn-isolation.sql` verifies cross-owner access and revoked-session rejection in a rolled-back transaction. The advisor currently reports disabled leaked-password protection; it is not silently enabled or represented as a clean advisory report.

Enable Email Auth and optionally Google, and allow `/auth/callback` for your local/hosted origins. For SSR email confirmation use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` in the Supabase email template. Set Site URL to the intended app origin. Google OAuth uses `/auth/callback`. The schema explicitly grants authenticated Data API access and enables owner RLS.

In Circle Console configure the User-Controlled Wallet App ID, Modular Client Key and Passkey Domain. Passkeys are bound to that domain. Sessions are deliberately memory-only and require reconnecting after refresh. Recovery is managed through the wallet provider; no private keys or PINs are stored in the workspace.

For passkey execution, Hodd requires the official Gas Station paymaster. [Circle's current transfer guide](https://developers.circle.com/wallets/modular/transfer-tokens) says Arc Testnet sponsorship is automatic; a Console policy is required for mainnet, which Hodd does not enable. Hodd refuses any unsponsored/paid-paymaster fallback. Embedded execution uses the official User-Controlled Wallet server adapter; the browser SDK presents the PIN challenge. MetaMask/Rabby verify the selected account and Arc Testnet before each single-call transaction. Logout, reconnect, expiry and account/network changes invalidate the in-memory signer; quotes are bound to the original authenticated session, selected wallet, scope and policy snapshot.

For hosting, configure environment variables in the host project. `.env.local` stays on your machine. Public-prefixed configuration is included in the browser bundle; the Circle API key stays server-side.

## Live testnet demo

Anyone can sign up and use their own wallet on Arc Testnet at `app.hoddfinance.xyz`. Execution runs as a durable, request-driven state machine, so it works on serverless hosts: quotes (`earn_quotes`), Earn executions (`earn_executions`), verified receipts and one shared per-wallet lease (`wallet_leases`, Earn and payments) live in Supabase. Each request advances one step: the server records the exact next call, the browser wallet signs and reports the hash, the server verifies the receipt and moves on. Earn Kit's next call is captured without signing (`src/lib/earn/capture.ts`) and validated before any wallet sees it (`src/lib/earn/router.ts`: allowlisted vault and router only, every swept token back to the user's wallet, input equal to the quote, enough time before the router deadline).

Live mode (`TESTNET_LIVE`) opens only when all of these hold: Vercel production deployment, request host exactly `app.hoddfinance.xyz`, `HODD_TESTNET_LIVE=true` (Production scope), and the database kill switch on. Preview URLs and `hodd.vercel.app` stay closed. The Origin must equal `https://app.hoddfinance.xyz`. The dev test signer never exists on a hosted build.

- **Kill switch:** `update public.hodd_live_controls set enabled = false where key = 'EXECUTION';` pauses all live execution within 30 seconds (`EARN`, `PAYMENTS` and `PROVIDER:<name>` pause one area). Circle PIN (`PROVIDER:CIRCLE_USER_CONTROLLED`) starts disabled until its first production run is verified.
- **Ownership:** before live operations, a free signed message proves the signed-in user controls the wallet (EOA signature, or ERC-1271/6492 for passkeys; Circle PIN wallets are proven by Circle).
- **Limits:** per user 6 quotes/reviews a minute and 60 a day, 2 execution starts a minute and 20 a day, 60 status polls a minute, 5 Circle sessions an hour, plus global daily caps. Each deposit or payment is capped at 1,000 testnet USDC; withdrawals are never capped. One open execution per user and per wallet.
- **Uncertainty:** an unanswered request past its deadline closes as FAILED for Earn only when the wallet nonce is unchanged (a late router call reverts on its signed deadline); payments never auto-release and need a pasted hash, or an unchanged nonce plus the user's confirmation.

Production environment (Vercel, Production scope), then redeploy: `SUPABASE_SECRET_KEY`, `CIRCLE_API_KEY`, `NEXT_PUBLIC_CIRCLE_APP_ID`, `NEXT_PUBLIC_CLIENT_KEY` (restricted to `app.hoddfinance.xyz`), `HODD_TESTNET_LIVE=true`, and optionally `ARC_TESTNET_RPC_URL` and the Hoddie keys. Never set `HODD_TEST_SIGNER_*` or the local execution flags there. Public sign-up also needs custom SMTP in Supabase Auth (the built-in sender allows only a few emails an hour).

## Sites and domains

One Vercel project serves two sites, chosen by the request host in `src/proxy.ts` (host lists live in `src/lib/site/hosts.ts`):

| Host | Serves |
| --- | --- |
| `hoddfinance.xyz`, `www.hoddfinance.xyz` | Landing page (`/landing`, rewritten from `/`). API routes return 404; console paths redirect to the app host. |
| `app.hoddfinance.xyz` | Treasury console, login, auth callbacks and API routes. Not indexed (`robots.txt` disallows everything). |
| any other host (`hodd.vercel.app`, preview URLs, localhost) | Treasury console, so existing sessions and previews keep working. The landing page is always available at `/landing`. |

DNS (at the registrar, unless the domain's nameservers are moved to Vercel): `A hoddfinance.xyz → 76.76.21.21`, `CNAME www → cname.vercel-dns.com`, `CNAME app → cname.vercel-dns.com`. Use the exact values Vercel shows for the project if they differ.

Moving the console to `app.hoddfinance.xyz` needs matching provider settings, otherwise sign-in and passkeys fail on the new origin:

- Supabase Auth: add `https://app.hoddfinance.xyz/auth/callback` and `https://app.hoddfinance.xyz/auth/confirm` to the redirect allow list and set the Site URL to `https://app.hoddfinance.xyz`.
- Circle Console: set the Passkey Domain to `app.hoddfinance.xyz` (passkeys are bound to the domain and will not carry over from `hodd.vercel.app`) and allow the new domain on the Modular client key.

Brand assets live in `public/brand` (derived from the master logo and star artwork; do not redraw them). Fonts are self-hosted from `src/app/fonts`: Archivo and IBM Plex Mono, both under the SIL Open Font License.

## Persistence

Signed-out visitors see a sign-in gate with a Circle testnet faucet link. Signed-in users start with an empty live Arc Testnet workspace. Legacy sample records and unchanged sample settings are cleaned automatically on load after cloud acceptance; paid, referenced or reserved bills and user-created records are preserved, with one SYSTEM activity recording the cleanup. Signed-in users load their own cloud record and a separate local cache. Changes are saved locally first and synchronized to Supabase; a visible message reports failed sync. Offline edits can be restored from the same account's cache. Ordinary workspace fields use last-write-wins; Stage 5 obligation revision checks reject conflicting edits, and pending payments lock financial mutations. Local activity is not a tamper-proof audit ledger. Wallet addresses are public metadata, not proof of wallet ownership for server authorization.

## Financial rules

```text
protected capital = obligations within 30 days + safety buffer + pending transactions
deployable capital = max(total treasury - protected capital, 0)
```

Draft/paid obligations are excluded. Active overdue obligations are included. APY is for display only. Morpho redeemable liquidity is the minimum of position value, `maxWithdraw` and vault liquidity. Public reads use one block per position. Missing/stale positions contribute no redeemable liquidity and are labeled unavailable. P&L is unavailable without principal history.

Arc Testnet chain ID is `5042002`; canonical 6-decimal USDC is `0x3600000000000000000000000000000000000000`. The native gas and ERC-20 views represent one economic USDC balance and are counted once.

Deposit plus fee reserve must fit deployable capital, liquid funds and the Morpho strategy cap while preserving obligations, safety buffer and minimum coverage. Withdrawal/redeem is bounded by fresh position value, max withdrawal and vault liquidity, not the allocation cap. Missing gas estimates or stale/unavailable data block execution. Earn quotes reserve a 20% integer gas margin for each reported step, with a bounded gas price and Arc's 20 Gwei floor; native 18-decimal fee reserves round up to 6-decimal USDC. At signing, the server simulates the exact pending call and binds its gas limit and price to the quote. Browser wallets receive those explicit ceilings, so the browser does not need a separate public RPC gas simulation. A fresh estimate or price above the quote stops before the wallet signature request. APY never determines amounts.

## Execution and recovery

Circle PIN/SCA requires `feeLevel` for SCA transactions (SDK error 155232), so its challenges use `feeLevel: MEDIUM`; the fee reserve is enforced by policy rather than by the challenge. The provider stays switched off on the live host until a production run is verified. See [Circle contract execution](https://developers.circle.com/api-reference/wallets/user-controlled-wallets/create-user-transaction-contract-execution-challenge) and [Gas Station](https://developers.circle.com/wallets/gas-station).

Quotes are single-use rows consumed atomically when an execution starts. The database lease prevents overlapping Earn or payment executions from spending the same wallet across users, hosts and restarts; uncertain outcomes keep it until resolved with evidence. Earn and payment dialogs offer **Check again**, **Verify this transaction** (paste a hash) and **I rejected or closed the wallet request** (released only with an unchanged nonce). The local `.hodd-local` directory is no longer used.

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

## Live Earn findings (2026-10-07)

Rabby smoke evidence for a fresh test wallet: deposit 0.5 USDC (block 66009558), withdraw 0.25 USDC (66009751) and redeem-all with zero residual shares (66009872), each server-verified and stored in `earn_provider_evidence`. Fixes found during the live run:

- Earn Kit routes deposits and withdrawals through a router contract. Receipts are accepted only when the wallet's exact USDC/share transfer to the router, the router's exact-amount vault event and the forwarded shares/assets to the wallet all match.
- The allowlisted vault is a Morpho Vault V2, whose `maxWithdraw` always returns 0. Redeemable liquidity is proven with a same-block `withdraw` simulation instead.
- The quote's gas price ceiling already includes the 2x buffer; signing compares the raw network price against it and never signs above it.
- Earn Kit cannot simulate a deposit before its approval exists and quotes ~265k gas; a fresh wallet's first routed deposit needs ~447k. Unsimulated deposits reserve at least 500k gas before buffering.
- Earn Kit rewraps signer errors as `RPC_ENDPOINT_ERROR`; Hodd records its own `SIGNING_PREPARATION` code first. A verified approval followed by a pre-signature failure ends FAILED and releases the lease.
- Signers are memory-only. The wallet panel shows signer state live with **Reconnect signer**; quotes and confirmations require an active matching signer, and the workspace scope survives reloads per tab.
- Rabby may raise the gas limit it was given; the signed gas price is still the bounded one. Circle's Earn position index can lag the chain by several minutes after a withdrawal, temporarily rejecting withdrawal quotes.

## Local test signer (development only)

For repeatable Arc Testnet regression runs, `next dev` can expose a server-held test signer. Put `HODD_TEST_SIGNER_ENABLED=true` and `HODD_TEST_SIGNER_PRIVATE_KEY` (a dedicated, testnet-only key) in git-ignored `.env.development.local`; production builds never load that file. The signer exists only under `next dev` on loopback, and `POST /api/dev/test-signer` additionally requires the Earn execution guard (flag, loopback, same origin, JSON) and a signed-in workspace that selected this signer. It signs only the exact call and server-bound gas ceiling of that session's pending Earn request, or the exact USDC transfer of a pending payment within its approved EOA fee quote, once; arbitrary calldata is refused. Because the server holds the key, an unclaimed TEST_SIGNER payment request is provably unsigned and ends FAILED instead of UNKNOWN. Payment execution additionally requires `HODD_PAYMENT_EXECUTION_ENABLED=true` (keep it in `.env.development.local`).

Live TEST_SIGNER run (2026-10-07, smoke scope): Earn deposit 0.5 / withdraw 0.25 / redeem-all (zero residual) and a 0.10 USDC Stage 5 payment to a user-owned test recipient, CONFIRMED with a verified canonical USDC receipt (block 66015915) and the obligation PAID. These prove Hodd's server/ledger path, not MetaMask, Rabby or Circle signing. The browser learns only the public address. Evidence is stored as `TEST_SIGNER` and never counts for MetaMask, Rabby or Circle acceptance.

## Stage 6: Claude connector (MCP)

Users can connect Hodd to Claude (claude.ai, Claude Desktop, Claude mobile) as a custom connector at `https://<app host>/api/mcp` (Streamable HTTP, stateless, `mcp-handler` 2). ChatGPT is not supported yet. The **Connections** page shows the URL, setup steps, connected apps (revocable) and every change made through Claude.

- **Sign-in:** Supabase Auth acts as the OAuth 2.1 server (beta). Claude registers dynamically, the user signs in to Hodd and approves on `/oauth/consent`. A pending consent survives the sign-in round trip (`hodd_after_login` cookie, consent path only). Unauthenticated MCP calls get `401` + `WWW-Authenticate: Bearer resource_metadata=…`; `/.well-known/oauth-protected-resource/api/mcp` publishes `resource` = the exact MCP URL and Supabase as the authorization server.
- **Tokens:** verified with `jose` against Supabase JWKS (issuer, `aud=authenticated`, expiry) and must carry a `client_id` claim, so normal browser session tokens are refused. Every call re-checks the session (`auth.getUser`), then acts as the user through owner RLS; no service-role key is used.
- **Reads** (`readOnlyHint`): overview, obligations, "can I pay it?" (`assessPayment` with live balances, a fee estimate and a Morpho funding plan), allocation preview, vaults/positions, policy, activity, payments, Claude requests.
- **Writes** are two steps. `hodd_prepare_change` changes nothing and returns a preview plus a 10-minute HMAC confirmation (`HODD_MCP_HANDLE_SECRET`, server only) bound to user, connector client, scope, kind, the exact values and the workspace revision. The write tools (`destructiveHint`) repeat the exact values with that confirmation; `hodd_apply_agent_action` writes the workspace and the `agent_actions` record atomically, once (primary key), only for connector tokens. Claude asks the user before each write tool; keep them on "Needs approval" (claude.ai has no MCP elicitation, so "Always allow" would skip the question).
- **Money:** `hodd_request_payment` / `hodd_request_earn` only create requests (24 h). They appear on the Portfolio page under **Claude requests**, open the normal payment/Earn dialog pre-filled, and finish with a fresh quote and the user's wallet signature (live testnet host or local development).
- **Concurrency:** workspace rows have a `revision`; every update must name the revision it was based on (`workspace revision conflict` otherwise). Browsers send it and reload on conflict or when the tab regains focus, so a stale tab cannot overwrite a change approved in Claude, and vice versa.
- **Audit:** connector changes add an `AGENT` activity marked "approved in Claude" and an `agent_actions` row (owner-readable; browsers cannot insert).

Live verification (2026-10-08, production `app.hoddfinance.xyz`): a client registered through dynamic registration, the consent page approved it, and the issued ES256 token (with `client_id` and `session_id`) listed all 19 tools; overview and "can I pay?" returned live Arc balances; in the smoke workspace a bill was created (altered values and a replay were refused), a payment request appeared under **Claude requests** and was dismissed in the app, a stale browser tab picked up the change on focus without conflict, and revoking the connection on **Connections** made the same token fail immediately.

One-time setup (done for the hosted project): in Supabase enable **Authentication → OAuth Server**, set the authorization path to `/oauth/consent`, allow dynamic client registration, and keep the Site URL on the app host. No host variable is required: the confirmation key comes from `HODD_MCP_HANDLE_SECRET` if set, else HKDF of `SUPABASE_SECRET_KEY`/`CIRCLE_API_KEY` (label `hodd-mcp-confirmation-v1`), else a random key the database generated (`hodd_agent_confirmation_key()`, connector tokens only). Without Supabase variables the app falls back to the hosted project's public URL and publishable key. Apply `20261008125003_agent_actions.sql` and `20261008133206_agent_confirmation_key.sql`; `supabase/tests/agent_actions.sql` verifies revisions, connector-only writes, replay rejection, isolation and request resolution in a rolled-back transaction.


## Next work

Verify Circle Passkey and Circle PIN on the live host, then switch `PROVIDER:CIRCLE_USER_CONTROLLED` on. Financial calculations and amounts remain deterministic. Real integrations must follow current [Arc](https://docs.arc.io/), [Circle](https://developers.circle.com/wallets) and [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client) documentation.

## Stage 5 payment implementation status

Single-obligation, full-amount Arc Testnet USDC payment review uses server-owned policy inputs, fresh balances/positions and integer fee reserves. It does not use investment deployable capital as a payment limit. Earlier obligations, safety buffer, pending reservations and post-payment coverage must remain protected. Pending payments replace their protected obligation with amount + fee reserve, rather than double-counting the same obligation.

The payment ledger migration introduces owner-readable, server-written obligations and proposals, revision checks, atomic five-minute proposal claims, unique active wallet/obligation constraints and unique confirmed receipt references. Only server-verified canonical USDC Transfer evidence may finalize PAID. Browser activity remains local audit, not payment proof. Additive workspace fields preserve existing obligations/policy and schema-v4 caches.

`SUPABASE_SECRET_KEY` belongs only in git-ignored `.env.local` and server-only code. No entity secret or private key is required. Payment execution needs an open execution mode (local flag on loopback, or live testnet mode) and a server fee quote; every payment is then proven by its own verified receipt. Per-wallet smoke evidence no longer gates payments (it is still recorded for smoke runs as an operator audit trail). Preview URLs, `hodd.vercel.app`, non-loopback development hosts and mismatched origins remain closed. EOA, Circle PIN and sponsored Circle Passkey signing are supported; PIN is switched off on the live host until verified.

`WalletFeeQuote` binds provider, wallet, Arc chain, operation digest and five-minute expiry. EOA uses a bounded Arc gas limit/price. PIN reserves Circle's official `estimateContractExecutionFee` (HIGH, doubled) and creates the challenge with `feeLevel`, which Circle requires for SCA wallets. Neither assumes sponsorship. Passkey server-side estimation uses only public credential ID/key and the SDK's estimation stub; it includes deployment, call, verification, pre-verification and paymaster gas. Only the [official Arc Gas Station address](https://developers.circle.com/wallets/gas-station/contract-addresses) qualifies as sponsored. The browser signs the exact quoted operation with its actual passkey; an estimation stub is never submitted. Reconnect existing passkey sessions to add this public metadata. No raw authenticator credential or signature is persisted.

`earn_provider_evidence` records server-verified smoke operations and SDK versions. Readiness re-reads real Arc receipts for this owner/wallet/provider, requires an allowlisted vault, ordered deposit (at most 1 USDC), partial withdrawal and redemption with no residual shares. Hand-entered flags and the old `wallet_provider_verifications` table do not enable execution. Evidence-table writes are server-only and owner reads use RLS. A `PARTIAL` redemption is not accepted as complete provider verification.

Payment and Earn share a durable per-wallet lease. Once a signing request is exposed, an uncertain outcome keeps its reservation and lease even if the browser reports cancellation. Known hashes can be rechecked without sending a new transaction. The lease is a database row (`wallet_leases`) maintained by triggers; releasing it requires evidence, never a manual delete. Receipt network fees are not represented as a sponsored wallet's actual debit.

PIN approval acknowledgment, Circle-observed approval, UserOperation hash, transaction submission and confirmed receipt are distinct. A UserOperation receipt must match the original account, nonce, exact calldata, factory, paymaster and approved gas ceilings. An outer transaction succeeding does not imply its UserOperation succeeded. Receipt recovery can resolve an existing UserOperation hash without sending anything. Verified EOA or passkey reverts atomically release the reservation but leave the obligation active; missing/ambiguous proof holds the lease. A lost claim response cannot release a lease until the ledger confirms cancellation. The UI refreshes PAID, reservations, Portfolio inputs and Activity from canonical cloud facts without re-uploading stale ledger data.

The ledger and state-audit migrations are applied. Rollback-only synthetic database tests cover owner isolation, browser write denial, PAID forgery, single-use claims, pending reservations and release. Automated jobs/routes test EOA signing orchestration, replay, parallel wallet leases, uncertain outcomes and environment guards. The UI reads owner-scoped server payment history and separates LOCAL AUDIT from ONCHAIN RECEIPT events. A newer local cache cannot revert a confirmed PAID record or override server reservations.

Apply all migrations, including `20261006151235_payment_provider_evidence_recovery.sql` and `20261006153410_payment_user_operation_receipt.sql`. Rollback-only `supabase/tests/payment_evidence_recovery.sql` additionally verifies evidence owner isolation/browser write denial, UNKNOWN retention, stale/cross-user failure rejection and EOA/UserOperation failure release without PAID.

Outstanding acceptance work: register real Stage 4 smoke receipt evidence, complete live payment smoke tests of at most 1 USDC to a user-owned test recipient for each enabled signer (Circle PIN, Circle Passkey, MetaMask and Rabby), and compare receipts, balances, positions and canonical records on real sessions. All current automated provider tests are mocks. No live payment has been performed by this checkpoint. Stage 6 originally waited for full Stage 5 live acceptance; on 2026-10-08 the owner chose to start it while MetaMask and Circle Passkey acceptance remain open. The Claude connector never signs or moves money, so it does not depend on those providers. No OpenAI/Anthropic API key, private key, PIN, seed phrase or entity secret is needed for this verification.

## Hoddie — treasury assistant

See [unified Hoddie validation](./docs/hoddie-unified-validation.md) for this merge and [the earlier checkpoint](./docs/hoddie-validation.md) for historical acceptance work.

Open `/hoddie` from the desktop sidebar or mobile navigation. EN/TR commands can read the main treasury, obligations, activity, policy, payment feasibility and allocation previews. New obligations, edits, policy/target changes and payment/Earn requests require an explicit review button in Hodd. A request never submits a transaction: existing fresh quote, policy, separate confirmation and wallet signing still apply. Earn/Send use the existing execution access policy; this assistant never changes it. The smoke-test workspace is not exposed to Hoddie.

Hoddie uses AI SDK 7 with pinned Google/OpenRouter adapters. It sends **only the latest masked command** and a selection-present boolean for structured intent parsing (2048 output-token maximum per provider attempt, no same-provider retry). Gemini is tried first; unavailable/unconfigured Gemini can fall back once to the verified free NVIDIA endpoint. Cancellation, quota and financial-policy errors never trigger another provider attempt. Missing consent goes directly to the read-only engine fallback. No account snapshot, financial result, previous result card, credentials or signing data is model context. Hodd's existing deterministic engine computes all financial outputs and uses exact minor units; the model cannot calculate or execute amounts. Known obligation names/recipient descriptions, addresses, emails, literal amounts, percentages, quoted new titles and ISO dates become placeholders; values stay on the server. This is not universal personal-data detection: do not enter confidential, sensitive or personal information into free services. New free-text fields can be completed in the native Hodd form instead.

Configure only in ignored `.env.local` (or server environment, never `NEXT_PUBLIC_`):

```dotenv
GEMINI_API_KEY=your_server_key
HODDIE_GEMINI_FREE_TIER_CONFIRMED=true
OPENROUTER_API_KEY=your_server_key
```

Verify the Gemini project's unpaid tier in Console before setting the confirmation flag. Automatic routing prefers `gemini-3.8-flash`, then OpenRouter's `nvidia/nemotron-3-super-120b-a12b:free`. There is no user model selector. OpenRouter remains NVIDIA-only, its own provider fallback is off and maximum prompt/completion price is zero. Its public endpoint catalog must advertise zero prices and structured outputs; otherwise the call fails closed. API metadata records the actual interpreter; the UI does not display its name. Check current [Gemini unpaid terms](https://ai.google.dev/gemini-api/terms), [Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) and [OpenRouter provider routing](https://openrouter.ai/docs/guides/routing/provider-selection) before enabling real keys. Free quotas/availability are not guaranteed.

The first-party Supabase session is verified on each request; OAuth connector tokens are rejected. Explicit consent for automatic external command interpretation uses a signed HttpOnly session cookie; an old single-provider consent is not upgraded silently. Reviews bind user, session, wallet, routing permission, consent epoch, workspace revision and exact payload for ten minutes. Only `/api/hoddie/confirm` applies them; the model has no confirm/apply/execute tool. `hodd_apply_hoddie_action` atomically advances the workspace and records a `HODDIE` action; duplicate action IDs or stale revisions roll back. Existing MCP OAuth-only writer requirements are unchanged. Hoddie signing handles require an existing server-only root (`SUPABASE_SECRET_KEY`, `CIRCLE_API_KEY` or `HODD_MCP_HANDLE_SECRET`), with a separate HKDF label; no private key, seed, PIN or entity secret is needed.

The hosted project already has `20261008203912_hoddie_first_party.sql` applied as version `20261008203912`; do not reapply it there. Atomic content-free counters limit a user to ten provider attempts/form requests per minute and the entire app to 45 OpenRouter model attempts per UTC day. A fallback reserves its own quota (so one command may consume two minute slots); reservations failing on either limit roll back together. Counters expire after two days; no chat database is created. Conversation lives only in React memory across route navigation; refresh/logout/account/wallet changes clear it and pending reviews. The compact chat places suggested commands in a horizontally scrollable row directly above the composer; wallet review requests are collapsed until opened. Stop cancels interpretation, not an already-approved write; an uncertain confirmation must be checked in Activity, never automatically retried.

`supabase/tests/hoddie.sql` uses rollback-only synthetic sessions to check first-party/OAuth isolation, revisions, replay, owner reads, expired sessions and exact quotas. Unit/component/E2E provider tests use mocks and are **not live model acceptance**. Real Gemini/OpenRouter interpretation plus user-approved workspace changes still require configured keys and separate live verification.

Security advisor notes: the private quota table deliberately has no client RLS policy/privileges; authenticated SECURITY DEFINER RPCs deliberately enforce active first-party ownership inside the function. The hosted project's existing leaked-password protection warning is outside this change; see [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Review [SECURITY DEFINER guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable) when changing these boundaries.


Instant read-only answers use `answers.ts` and the Treasury Engine, including status, facts, sources and follow-ups in English or Turkish. No model is called for these questions, or when signed out, without consent or without configured keys. Provider outages return the same deterministic fallback, with no automatic write or retry. Disconnected live accounts report `NOT_CONNECTED` and zero balances; unavailable or partial live balances pause financial answers.

The only API endpoints are `/api/hoddie/chat`, `/api/hoddie/consent` and `/api/hoddie/confirm`. The UI does not name an interpreter. Keys are `GEMINI_API_KEY` and `OPENROUTER_API_KEY`, with `HODDIE_GEMINI_FREE_TIER_CONFIRMED=true` only after unpaid-tier verification; `HODDIE_GEMINI_MODEL` optionally selects a verified free-tier Flash model. The pinned OpenRouter endpoint and zero-price verification remain unchanged.

Money requests are saved through the signed review and separate confirmation route. Wallet review requests then open the normal `EarnOperationDialog` with the proposed amount prefilled and current engine limits rechecked, or `PaymentDialog` for the selected obligation. The dialog obtains a fresh quote and requires explicit confirmation and the user wallet signature. Chat text, including typed approvals, never executes a transaction or applies a workspace change.

MIT — see [LICENSE](./LICENSE).

## Circle Gateway: USDC on every chain

Overview shows the selected wallet's USDC on 12 Circle Gateway testnets plus its Gateway unified balance (`/api/gateway/balances`, public read, display only — the Treasury Engine still counts Arc funds alone). **Bring USDC to Arc** deposits into Gateway on the source chain if needed (exact approval + `GatewayWallet.deposit`), then the user signs one free EIP-712 burn intent; Circle's Forwarding Service mints on Arc to the user's own wallet and Hodd verifies the mint before offering the normal Morpho deposit within the engine's limit. **Pay from another chain** (Obligations) puts a payment proposal on the `GATEWAY` rail: Gateway mints the exact amount straight to the obligation's Arc recipient, and PAID still requires a verified GatewayMinter `Transfer(0x0 → recipient, amount)`. Direct minting to a third-party recipient was verified live before building this (see [Gateway validation](./docs/gateway-validation.md)). Gateway signing is EOA-only (MetaMask, Rabby, dev test signer). No new database migration or environment variable is needed; execution uses the existing Earn/payment gates and kill switches.

## Autopilot (agent wallet)

`/autopilot` gives a separate Circle developer-controlled wallet (one EOA per user on Arc Testnet) a budget. The user funds it with a normal USDC transfer they sign; Hodd's deterministic engine then invests idle budget in the allowlisted Morpho vault, refills the agent's cash reserve, and sends liquidity back to the user's proven wallet when obligations need it. The agent can only call the Earn router for the allowlisted vault and transfer canonical USDC to the owner's verified wallet; every run records its inputs, decision, Circle transaction and verified receipt, and UNKNOWN outcomes are never resubmitted. Mandate changes use a two-step review/confirm. Requires `supabase/migrations/20261010112126_agent_autopilot.sql`, `CIRCLE_API_KEY`, `CIRCLE_ENTITY_SECRET`, `CRON_SECRET` (daily Vercel cron; **Run now** covers the rest), `HODD_AGENT_EXECUTION_ENABLED=true` locally, and the `AGENT` row in `hodd_live_controls` (off by default). Live custody evidence and the fixes it produced: [Autopilot validation](./docs/autopilot-validation.md).
