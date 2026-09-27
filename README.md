# Hodd

Hodd is a liquidity-first treasury operations console for individuals, freelancers, and small businesses. It is being built for the Tameion Agents Hackathon on Arc.

This repository currently contains **Stage 1 only**: a responsive, read-only product foundation using clearly labeled sample data. It does not connect to a wallet, RPC endpoint, database, LLM, Morpho vault, or payment execution service.

## What Stage 1 includes

- Portfolio view with total treasury, one Arc USDC balance, upcoming obligations, safety buffer, deployable capital, next-payment safety, sample allocation, recent activity, and agent explanations.
- Invest view with a deliberately small strategy shelf and a review-only allocation preview.
- Obligations view with filters and accessible read-only detail drawers.
- Activity view with actor, rationale, policy, approval, and execution fields.
- A runtime-validated fixture model behind a `TreasuryRepository` interface.
- Loading, empty, stale/unavailable, error, responsive, keyboard, and reduced-motion states.

## Important boundaries

- All values and records are sample data dated September 27, 2026.
- Derived financial values are fixture fields; no Treasury Engine or Policy Engine runs in Stage 1.
- No button creates a proposal, signs a message, approves a token, or submits a transaction.
- Hodd shows one USDC balance on Arc. Native gas and the ERC-20 interface expose the same underlying USDC balance and must never be double-counted.
- USDC values use decimal-string minor units with six decimals. JavaScript floating-point numbers are not used for monetary storage.
- No secrets, wallet addresses, recovery files, OTPs, API keys, or entity secrets belong in this repository.

## Stack

- Next.js App Router and React
- TypeScript in strict mode
- Tailwind CSS
- Zod runtime schemas
- Vitest and Testing Library
- Playwright for desktop and mobile browser verification
- pnpm

## Run locally

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Verify

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

## Data architecture

Routes are Server Components that request read-only data through `TreasuryRepository`. Interactive filters and accessible drawers are isolated Client Components. The fixture repository can later be replaced by persistent and onchain adapters without coupling screens to data files.

Money is represented as:

```ts
type Money = {
  currency: "USDC" | "USD";
  minorUnits: string;
  decimals: number;
};
```

## Integration roadmap

The following stages are intentionally not implemented here:

1. Stage 2 — deterministic Treasury Engine, Policy Engine, obligation editing, liquidity waterfall, and tests.
2. Stage 3 — Circle treasury wallet and live Arc Testnet USDC balance.
3. Stage 4 — selected Morpho vault discovery, deposit, withdrawal, and redeem.
4. Stage 5 — immutable payment proposals, approval, Arc App Kit Send, receipt tracking, and duplicate-execution protection.
5. Stage 6 — business-level MCP tools and natural-language intent parsing.

Current integration work must be checked against the latest official [Arc documentation](https://docs.arc.io/) and [Circle developer documentation](https://developers.circle.com/). Circle Skills are used for stable architectural guidance; changing method names, chain data, and contract addresses must be verified from live official sources before implementation.

## License

MIT — see [LICENSE](./LICENSE).
