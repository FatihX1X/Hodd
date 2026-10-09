# Hoddie validation checkpoint — 2026-10-09

## Console redesign integration

The `hoddie` branch preserves the original WIP in `d4c7549` and merges the
console redesign from `origin/main` at `9e2d13f`. Three conflicts were resolved:
`app-shell.tsx` keeps Policy and adds Hoddie to desktop/mobile navigation;
`agent-requests.tsx` keeps request-source labels with the dark presentation;
`treasury-workspace-provider.tsx` keeps Hoddie's canonical refresh hook.
The layout and dependency files merged cleanly; `corepack pnpm install`
confirmed the existing lockfile is current.

Chat, consent, sourced cards, native drafts and approval reviews now use the
console's ink/paper/blue tokens, shared input/button recipes and typography.
The compact layout, horizontal suggestions and collapsed wallet requests remain.
Mobile tests check all seven navigation entries and no overflow at 320, 375 and
640 pixels. The Playwright server command uses Corepack so a standalone `pnpm`
binary is not required on PATH.

Security and API implementation are unchanged from the WIP. The hosted migration
`20261008203912` was already applied and was not changed or reapplied. No live
model calls, transactions or hosted database writes were performed in this run.
Earn/payment execution files match the merged redesign; other worktrees and
local `main` were not modified. The branch has not been pushed.

This is code/mock acceptance, not live provider acceptance. Gemini/OpenRouter keys
were absent during the original standalone validation. The integration regression
uses mocks even when local keys are configured. No live model call or onchain
transaction was sent.

Local setup was subsequently verified on 2026-10-09: both provider keys and the
Gemini free-tier confirmation flag are present, without logging their values.
The rebuilt public client JavaScript contains zero matches for either provider
key or the existing server secrets. The local development server is available
on port 3001 and the signed-in Hoddie page is awaiting explicit provider consent.
Live intent parsing and user-approved workspace change acceptance remain pending.

## Automated results

- `corepack pnpm typecheck`: passed.
- `corepack pnpm lint`: passed.
- `corepack pnpm exec vitest run --maxWorkers=2`: 57 files / 292 tests passed.
- `corepack pnpm build`: passed; Hoddie page and three API routes included.
- `corepack pnpm exec playwright test --workers=2`: 50 desktop/mobile tests passed.
- `git diff --check`: passed.
- Secret scan: zero matches in tracked files and public client assets; local env files remain ignored.
- Prior standalone dependency audit: eight advisories (details below); not rerun for this merge.

Two-worker regression runs avoid CPU contention from simultaneous browser/build
processes on this Windows host. An earlier unrestricted concurrent run timed out
in an existing component test; no Stage 5/6 tests were changed to hide failures.

## Verified boundaries

- Latest-command transport only; no account snapshot, result cards or conversation history in the model request.
- Masked literal money/address/date/title references; fabricated tokens, ambiguous currencies and credentials rejected.
- Deterministic server financial results; no LLM-generated amount or policy limit.
- Explicit provider consent and first-party session; connector identities not accepted.
- Owner/session/wallet/revision/provider/consent/payload-bound ten-minute reviews.
- Separate confirmation route, double-click protection, atomic action ID and revision conflict rejection.
- Logout/scope changes clear memory and discard late responses; SPA navigation retains memory, document reload does not.
- Complete live data required for money requests; selected-vault position/liquidity checks, no executable quote created.
- Production Earn/Send execution remains closed. Existing Stage 5/6 tests are included in regression runs.
- Supabase rollback-only test passed at the prior standalone checkpoint: first-party/MCP isolation, owner reads, replay, revision, deleted session, minute quota and UTC daily quota. It was not rerun against the hosted database during this integration.
- Public client JavaScript was scanned against existing server secret values: zero matches (values were not logged).

## Compact chat and automatic routing update

- No model picker or large suggestion sidebar. Suggested commands sit in a single
  horizontal scrolling region immediately above the composer, with keyboard/touch
  access and previous/next buttons. Wallet review requests start collapsed.
- Gemini is preferred when its key and free-tier flag are configured. A provider
  failure may fall back once to the pinned zero-price NVIDIA Nemotron endpoint.
  Each provider has zero SDK retries and a 20-second generation timeout; endpoint
  discovery has a five-second timeout. No other or paid endpoint is permitted.
- Automatic routing requires new explicit `AUTO` consent for both destinations;
  a previous Gemini-only consent is not expanded. Review handles remain bound to
  that consent epoch, session, wallet and workspace revision. Responses identify
  the actual interpreter without sending result cards back to either model.
- Every attempt reserves the existing atomic quota. Fallback consumes a second
  minute slot and an OpenRouter daily slot. Quota, consent, cancellation and
  deterministic policy errors never trigger fallback or a financial retry.
- Mock tests verify the routing sequence, unavailable setup, bounded failures,
  cancellation, daily budget rejection and unchanged financial approval boundary.
- All 50 desktop/mobile Playwright regressions passed, including suggestions'
  horizontal scrolling, no page overflow, focus, explicit approval and persistence.

These are code/mock checks; real two-provider interpretation remains pending.

## Remaining live acceptance

Configure ignored `.env.local` with server-only `GEMINI_API_KEY`,
`OPENROUTER_API_KEY` and `HODDIE_GEMINI_FREE_TIER_CONFIRMED=true` after checking
the Gemini project's unpaid tier. Verify each provider's real intent parsing in a
signed-in main workspace, review the exact change, and let the user click Apply.
Do not use a live model test to send funds. No private key, seed, PIN or entity
secret is required for Hoddie.

## Dependency audit (not clean)

The prior standalone audit reported eight advisories: two high, four moderate, two low.
These are in pre-existing Next/Circle/ESLint dependency paths, not the new AI
provider packages. They were not changed as part of this isolated Hoddie work.

| Package | Severity | Advisory |
| --- | --- | --- |
| Next 16.3.6 | High | [Image Optimization SSRF](https://github.com/advisories/GHSA-cjq9-62q9-8jv4) |
| Next 16.3.6 | Moderate | [Draft-mode cache fill](https://github.com/advisories/GHSA-3w37-wq28-93x7) |
| Next 16.3.6 | Moderate | [Self-hosted cache poisoning](https://github.com/advisories/GHSA-4jqv-mc3x-m676) |
| Next 16.3.6 | Moderate | [Metadata route information disclosure](https://github.com/advisories/GHSA-f87g-xv8r-7p7x) |
| Next 16.3.6 | Moderate | [SSG/ISR substitution and DoS](https://github.com/advisories/GHSA-mcj8-r9mp-w47p) |
| Next 16.3.6 | Low | [Development MCP disclosure](https://github.com/advisories/GHSA-39w2-rjm5-chcv) |
| braces 3.0.3 (ESLint path) | High | [Nested-pattern stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) |
| elliptic 6.6.1 (Circle path) | Low | [Risky cryptographic implementation](https://github.com/advisories/GHSA-848j-6mx2-7j84) |

Next advisories identify 16.3.8 or newer as patched. A separate coordinated
framework/SDK maintenance change should update and revalidate those dependencies;
do not treat this checkpoint as a clean production security release.

Existing peer warnings also remain: Solana kit expects TypeScript 5 while this
repo uses 6; ws 7 expects utf-8-validate 5 instead of 6; older abitype expects Zod
3 instead of 4. The new AI SDK packages have their declared peers satisfied.

## Supabase advisors

The private quota table intentionally has RLS with no client policy and no client
privileges. Hoddie SECURITY DEFINER RPCs intentionally expose only active
first-party owner operations, with an empty search path; existing MCP RPCs were
not weakened. The hosted project's pre-existing leaked-password protection
warning remains. See the [database advisor guide](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
and [password protection guide](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).
