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
- Supabase RLS limits each user to their own rows. No service-role key is used.

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

For passkey execution, enable Arc Testnet Gas Station/paymaster sponsorship for the Modular project. Hodd refuses an unsponsored fallback. Embedded execution uses the official User-Controlled Wallet server adapter; the browser SDK presents the PIN challenge. MetaMask/Rabby verify the selected account and Arc Testnet before each single-call transaction. Logout, reconnect, expiry and account/network changes invalidate the in-memory signer; quotes are bound to the original authenticated session, selected wallet, scope and policy snapshot.

For hosting, configure environment variables in the host project. `.env.local` stays on your machine. Public-prefixed configuration is included in the browser bundle; the Circle API key stays server-side. This change does not deploy the application.

## Persistence

Guests use a local demo workspace. Signed-in users load their own cloud record and a separate local cache. Changes are saved locally first and synchronized to Supabase; a visible message reports failed sync. Offline edits can be restored from the same account's cache. Concurrent multi-device editing is last-write-wins; local activity is not a tamper-proof audit ledger. Wallet addresses are public metadata, not proof of wallet ownership for server authorization.

## Financial rules

```text
protected capital = obligations within 30 days + safety buffer + pending transactions
deployable capital = max(total treasury - protected capital, 0)
```

Draft/paid obligations are excluded. Active overdue obligations are included. APY is for display only. Morpho redeemable liquidity is the minimum of position value, `maxWithdraw` and vault liquidity. Public reads use one block per position. Missing/stale positions contribute no redeemable liquidity and are labeled unavailable. P&L is unavailable without principal history.

Arc Testnet chain ID is `5042002`; canonical 6-decimal USDC is `0x3600000000000000000000000000000000000000`. The native gas and ERC-20 views represent one economic USDC balance and are counted once.

Deposit plus fee reserve must fit deployable capital, liquid funds and the Morpho strategy cap while preserving obligations, safety buffer and minimum coverage. Withdrawal/redeem is bounded by fresh position value, max withdrawal and vault liquidity, not the allocation cap. Missing gas estimates or stale/unavailable data block execution. Gas prices respect Arc's 20 Gwei floor; native 18-decimal fee reserves round up to 6-decimal USDC. APY never determines amounts.

## Local execution and recovery

Quotes and atomic consumption markers are stored in git-ignored `.hodd-local/quotes`. A per-wallet execution lease prevents overlapping quotes from spending the same wallet. Live jobs run in the development server process. A server restart does not replay consumed quotes; uncertain executions keep their lease and require manual review. Do not delete these files as a retry mechanism.

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

Dependency audit: patched `undici`, `uuid` and `@grpc/grpc-js` transitives. One low-severity [elliptic advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84) remains through Circle/Ethers dependencies; the reported fix `6.6.2` is not published in the registry. Audit does not currently pass cleanly.

## Next work

Complete the three-provider live testnet verification before declaring Stage 4 complete. Stage 5 payments/Send, proposals and deployment are out of scope. Financial calculations and amounts remain deterministic. Real integrations must follow current [Arc](https://docs.arc.io/), [Circle](https://developers.circle.com/wallets) and [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client) documentation.

MIT — see [LICENSE](./LICENSE).
