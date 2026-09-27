# Hodd

Hodd is a liquidity-first treasury operations console for individuals, freelancers, and small businesses, built for the Tameion Agents Hackathon on Arc.

This repository contains **Stage 2**: a deterministic Treasury Engine and a browser-local, editable treasury workspace. It does not connect to a wallet, RPC endpoint, database, LLM, Morpho vault, or payment execution service.

## What Stage 2 includes

- Exact minor-unit financial arithmetic using decimal strings and `bigint`.
- A 30-day obligation horizon with create and edit flows for draft/upcoming obligations.
- Deterministic protected capital, deployable capital, liquidity coverage, payment feasibility, and shortfall calculations.
- A configurable safety buffer, minimum coverage floor, strategy caps, and fixed liquidity waterfall.
- Engine-generated allocation previews that leave blocked or capped amounts in Liquid USDC.
- A versioned, Zod-validated local workspace stored in the current browser.
- Local activity records for obligation, policy, and allocation-target changes.
- Fail-closed recovery for corrupt or unsupported saved workspace data.

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

## Local workspace boundary

- Data is private to the current browser profile and is not synchronized.
- There is no authentication or multi-user database in Stage 2.
- The workspace contains no private keys, API keys, wallet addresses, OTPs, recovery files, or entity secrets.
- Resetting the demo workspace removes the saved local record and restores the canonical 10,000 USDC scenario.
- Preview and policy controls cannot create proposals, signatures, approvals, deposits, withdrawals, or transfers.

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

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

## Integration roadmap

1. **Stage 3** — Circle treasury wallet, Arc Testnet connection, live USDC balance, wallet state, and authorization foundation.
2. **Stage 4** — selected Morpho vault discovery, position data, deposit, withdrawal, and redeem.
3. **Stage 5** — immutable payment proposals, approval, Arc App Kit Send, receipt tracking, and duplicate-execution protection.
4. **Stage 6** — business-level MCP tools and natural-language intent parsing.

Before each integration stage, method names, supported chains, addresses, and SDK behavior must be checked against current official Arc and Circle documentation. Circle Skills provide architectural guidance; they are not a substitute for current API references.

## License

MIT — see [LICENSE](./LICENSE).
