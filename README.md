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

**Earn transaction execution is paused during the user-owned signer migration.** Existing server quote/execute routes reject requests, including development requests with the old feature flag. Browser adapters are connected in memory; Circle PIN and passkey wallets currently connect for public reads. The user-owned quote/policy/confirmation flow must be verified before deposit/withdraw/redeem are enabled. Legacy developer-wallet signing code has been removed.

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

An entity secret, private key or seed phrase is not required for these user-owned wallet choices. End users connect through the browser, PIN or passkey; they do not run Circle CLI.

The Hodd Supabase project is provisioned in Frankfurt (`eu-central-1`) on the Free plan. Migration `20260930070053_user_owned_treasury.sql` matches the applied remote migration. Both tables have owner RLS; live SQL tests verified cross-owner reads, updates and inserts are rejected, and the security advisor returned no findings.

Enable Email Auth and optionally Google, and allow `/auth/callback` for your local/hosted origins. For SSR email confirmation use `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email` in the Supabase email template. Set Site URL to the intended app origin. Google OAuth uses `/auth/callback`. The schema explicitly grants authenticated Data API access and enables owner RLS.

In Circle Console configure the User-Controlled Wallet App ID, Modular Client Key and Passkey Domain. Passkeys are bound to that domain. Sessions are deliberately memory-only and require reconnecting after refresh. Recovery is managed through the wallet provider; no private keys or PINs are stored in the workspace.

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

Dependency audit: patched `undici` and `uuid` transitives. One low-severity [elliptic advisory](https://github.com/advisories/GHSA-848j-6mx2-7j84) remains through Circle/Ethers dependencies; the reported fix `6.6.2` is not published in the registry. Audit does not currently pass cleanly.

## Next work

Complete and verify the user-owned Earn signing flow, then payment proposals/approval/Send and receipt tracking. Financial calculations and amounts remain deterministic. Real integrations must follow current [Arc](https://docs.arc.io/), [Circle](https://developers.circle.com/wallets) and [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/creating-a-client) documentation.

MIT — see [LICENSE](./LICENSE).
