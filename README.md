# Hodd

Hodd is a liquidity-first treasury operations console for individuals, freelancers, and small businesses, built for the Tameion Agents Hackathon on Arc.

This repository contains **Stage 3**: a deterministic Treasury Engine connected to a read-only Circle Agent Wallet public address on Arc Testnet. It reads the wallet's canonical USDC balance but cannot sign, approve, submit, or execute transactions.

## What Stage 3 includes

- Exact minor-unit financial arithmetic using decimal strings and `bigint`.
- A 30-day obligation horizon with create and edit flows for draft/upcoming obligations.
- Deterministic protected capital, deployable capital, liquidity coverage, payment feasibility, and shortfall calculations.
- A configurable safety buffer, minimum coverage floor, strategy caps, and fixed liquidity waterfall.
- Engine-generated allocation previews that leave blocked or capped amounts in Liquid USDC.
- A versioned, Zod-validated local workspace stored in the current browser.
- Local activity records for obligation, policy, and allocation-target changes.
- Fail-closed recovery for corrupt or unsupported saved workspace data.
- Circle Agent Wallet onboarding that stores only a public Arc Testnet address.
- A server-only Arc Testnet reader with chain, address, block, and USDC decimal validation.
- Live USDC as the authoritative Treasury Engine balance when wallet mode is active.
- Fail-closed live mode: stale or unavailable RPC data pauses financial outputs and allocation previews.
- Explicit capabilities: balance reads are enabled; signing and transaction submission are disabled.

## Financial rules

```text
protected capital = upcoming obligations + safety buffer + pending transactions
deployable capital = max(total treasury - protected capital, 0)
```

Draft and paid obligations are excluded. Active and overdue obligations due within the fixed 30-day planning horizon are protected. Liquidity is evaluated in this order: Liquid USDC, Morpho, USYC, BTC-backed credit, BTC sale. Sources without an available adapter contribute zero liquidity.

USDC is represented as:

```ts
type Money = {
  currency: "USDC" | "USD";
  minorUnits: string;
  decimals: number;
};
```

No JavaScript floating-point value is used to store or add monetary amounts. Arc native and ERC-20 USDC views represent one economic balance and are never double-counted.

## Circle Agent Wallet onboarding

No API key, entity secret, seed phrase, or private key is required. Install and authenticate the Circle CLI using the current [official quickstart](https://developers.circle.com/agent-stack/agent-wallets/quickstart). Terms acceptance and OTP entry must be completed by the user in their own terminal.

```bash
npm i -g @circle-fin/cli
circle --version
circle wallet status
circle wallet list --chain ARC-TESTNET --type agent --output json
```

If the wallet needs test funds, use the current Circle CLI help and [Circle Faucet](https://faucet.circle.com). Paste only the resulting public `0x...` address into Hodd. Never paste an OTP, session token, recovery file, private key, or API key into the application.

Arc Testnet uses chain ID `5042002`. Hodd reads the standard 6-decimal USDC interface at `0x3600000000000000000000000000000000000000`. Arc's native 18-decimal gas view and ERC-20 view are one economic balance and are never displayed or counted separately.

## Persistence and security boundary

- Data is private to the current browser profile and is not synchronized.
- There is no authentication or multi-user database in Stage 2.
- The workspace may contain one public wallet address. It contains no private keys, API keys, OTPs, CLI sessions, recovery files, email addresses, or entity secrets.
- Resetting the demo workspace removes the saved local record and restores the canonical 10,000 USDC scenario.
- Preview and policy controls cannot create proposals, signatures, approvals, deposits, withdrawals, or transfers.
- The Circle CLI session is never called by the Next.js application and is not deployable application state.
- `ARC_TESTNET_RPC_URL` is an optional server-only override. Without it, Hodd uses the official public endpoint.

## Stack

- Next.js App Router, React, TypeScript strict mode, Tailwind CSS
- Zod runtime schemas
- Vitest and Testing Library
- Playwright desktop/mobile browser verification
- pnpm

## Run and verify

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Optional private RPC override:

```bash
cp .env.example .env.local
```

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

## Integration roadmap

1. **Stage 4** — selected Morpho vault discovery, position data, deposit, withdrawal, and redeem.
2. **Stage 5** — immutable payment proposals, approval, Arc App Kit Send, receipt tracking, and duplicate-execution protection.
3. **Stage 6** — business-level MCP tools and natural-language intent parsing.

Before each integration stage, method names, supported chains, addresses, and SDK behavior must be checked against current official Arc and Circle documentation. Circle Skills provide architectural guidance; they are not a substitute for current API references.

## License

MIT — see [LICENSE](./LICENSE).
