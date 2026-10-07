---
name: verify
description: Run Hodd's full local verification (typecheck, lint, unit tests, build) and report pass/fail. Use before any review, merge or ship.
---

# verify

Run from the repo root, in this order, stopping at the first failure:

1. `corepack pnpm typecheck`
2. `corepack pnpm lint`
3. `corepack pnpm test`
4. `corepack pnpm build`

`pnpm` is not on PATH on this machine; `corepack pnpm ...` always works (package.json pins pnpm@11).

Rules:
- Never edit a test just to make it pass. If a test fails, decide whether the code or the test is wrong, and say which.
- Report each step as PASS/FAIL with the failing test names and the first useful error line.
- `pnpm test:e2e` (Playwright) is separate; run it only when UI flows changed.
- Do not read `.env*` files; the build must pass without real secrets.
- Record the result in memory.md as "mock/unit" status. verify never proves on-chain behaviour.
