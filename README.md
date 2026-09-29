# Hodd

Hodd is a liquidity-first treasury operations console for individuals, freelancers, and small businesses, built for the Tameion Agents Hackathon on Arc.

This repository contains **Stage 4**: the deterministic Treasury Engine plus live Arc Testnet Morpho Earn discovery, wallet positions, quotes, deposits, partial withdrawals, and redeem-all through Circle App Kit. Hosted builds and production remain permanently read-only; real writes are available only on a loopback local development server with an explicitly configured Circle Developer-Controlled Wallet.

## Stage 4 capabilities

- Exact minor-unit arithmetic using decimal strings and `bigint`; monetary decisions never use floating point or an LLM.
- Versioned, Zod-validated browser workspace v3 with safe migration from Stage 2 and Stage 3 records.
- Live canonical Arc Testnet USDC reads and a single authoritative treasury wallet.
- Live Morpho USDC vault discovery through `@circle-fin/app-kit`, constrained by a server allowlist.
- Live APY, vault liquidity, wallet positions, shares, P&L state, and fresh maximum-withdrawable data.
- Treasury totals that combine liquid USDC and Morpho position value without double-counting Arc's native and ERC-20 USDC views.
- Redeemable Morpho liquidity equal to the minimum of position value, fresh maximum withdrawal, and vault liquidity. Unavailable data contributes zero liquidity.
- Deposit, partial withdraw, and redeem-all flows using quote → deterministic policy result → separate explicit confirmation.
- Short-lived, random, single-use server quote identifiers. Changed client payloads cannot alter the stored executable quote.
- Real transaction hashes only after Circle App Kit returns a confirmed result; ambiguous failures are never retried automatically.
- Local audit records kept distinct from onchain receipts.

## Financial and policy rules

```text
protected capital = upcoming obligations + safety buffer + pending transactions
deployable capital = max(total treasury - protected capital, 0)
```

Deposits are limited by both deployable capital and the Morpho strategy cap. The amount plus the quote's fee reserve must fit the lower limit. Withdraw and redeem operations are not blocked by an allocation cap, but cannot exceed the current redeemable position. APY is display and sorting data only.

Draft and paid obligations are excluded. Active and overdue obligations due within the fixed 30-day horizon are protected. The deterministic liquidity waterfall remains Liquid USDC → Morpho → USYC → BTC-backed credit → BTC sale; unavailable adapters contribute zero.

Arc Testnet uses chain ID `5042002`. Canonical 6-decimal USDC is `0x3600000000000000000000000000000000000000`. Arc's native 18-decimal gas view and ERC-20 interface represent one economic USDC balance and are never counted separately.

## Verified vault allowlist

Hodd does not accept an arbitrary vault address. `src/lib/earn/allowlist.ts` contains a versioned server allowlist selected from live official discovery after checking Arc Testnet, Morpho, canonical USDC, active status, liquidity, risk warnings, bytecode, and the verification block. Runtime discovery must still match those properties or the integration fails closed.

The allowlist is intentionally small and is not an endorsement or guarantee. Vault APY can change, liquidity can fall, smart contracts can fail, and withdrawals can be partial. Review the live warnings and quote before confirming.

## Local execution setup

Copy `.env.example` to the git-ignored `.env.local` and fill it locally:

```dotenv
CIRCLE_API_KEY=
CIRCLE_ENTITY_SECRET=
CIRCLE_WALLET_ADDRESS=0x...
HODD_EARN_EXECUTION_ENABLED=true
```

- `CIRCLE_API_KEY`: Circle testnet Developer Services API key.
- `CIRCLE_ENTITY_SECRET`: registered Developer-Controlled Wallet entity secret.
- `CIRCLE_WALLET_ADDRESS`: public Arc Testnet address of that wallet.
- `HODD_EARN_EXECUTION_ENABLED`: non-secret local execution switch.

The address in Hodd must exactly match the configured wallet. API keys and entity secrets are loaded only by `server-only` modules and must never be pasted into the UI, chat, logs, source control, or localStorage. Hodd never requests a private key, seed phrase, OTP, or recovery file.

Execution routes additionally require `NODE_ENV=development`, a loopback host, same-origin JSON, and explicit confirmation. Production rejects writes even if the feature flag is set. First deposits may require an approval plus the deposit transaction; the UI makes this multi-step possibility explicit.

If the existing Circle wallet is an Agent Wallet, create and fund an Arc Testnet Developer-Controlled Wallet in Circle Console before enabling writes. Read-only Agent Wallet addresses remain supported but cannot sign through Hodd.

## Redeem-all behavior

Redeem all obtains a fresh position and maximum-withdrawable quote, submits one withdrawal, then reads the position again. If shares remain, Hodd reports `PARTIAL/REVIEW`; it never submits a second transaction automatically. If the post-transaction position cannot be verified, status is `UNKNOWN` and the user must inspect the wallet and explorer before doing anything else.

## Persistence and boundaries

- Browser workspace data is local to one profile and is not synchronized.
- There is no authentication or multi-user database.
- The browser stores only public wallet metadata, policy, obligations, and audit records.
- Reset restores the canonical 10,000 USDC demo workspace.
- Allocation previews remain read-only and never create an Earn transaction.
- Stage 4 does not implement payment proposals or Send execution; those remain Stage 5 work.

## Stack

- Next.js App Router, React, strict TypeScript, Tailwind CSS
- Circle App Kit and Circle Wallets adapter
- Zod runtime schemas
- Vitest, Testing Library, and Playwright
- pnpm

## Run and verify

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
pnpm audit --prod
```

## Roadmap

1. **Stage 5** — immutable payment proposals, approval, Arc App Kit Send, receipt tracking, and duplicate-execution protection.
2. **Stage 6** — business-level MCP tools and natural-language intent parsing. Financial calculation, validation, and transaction amount selection remain deterministic.

Before each integration stage, method names, supported chains, addresses, and SDK behavior must be checked against current official Arc, Circle, and Morpho documentation.

## License

MIT — see [LICENSE](./LICENSE).
