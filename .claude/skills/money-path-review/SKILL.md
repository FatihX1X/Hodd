---
name: money-path-review
description: Checklist review for any code that computes, quotes, signs or records amounts (Earn, Send/payment, fees). Use on every diff touching treasury, wallet, earn or payment code.
---

# money-path-review

Check each item against the diff; report PASS/FAIL with file:line.

1. **Integer minor units.** USDC amounts are bigint/integer minor units (6 decimals). No `parseFloat`, float math or `toFixed` in calculations; formatting only at the display edge.
2. **Quote bound to the session.** A quote is bound to the authenticated owner, wallet address, provider, chain id (Arc Testnet 5042002), operation digest and 5-minute expiry. Client-supplied limits, policy or wallet overrides are rejected server-side.
3. **Uncertain outcome never auto-retries.** Timeout, lost response, cancel after the request was exposed, or ambiguous receipt keeps the reservation and wallet lease (UNKNOWN). Only a manual re-check of an existing hash is allowed; never re-send a transaction automatically.
4. **Only verified chain evidence marks PAID.** The server verifies the receipt (canonical USDC Transfer / exact calldata). Browser state is local audit only.
5. **Atomicity.** Reservation, lease and status changes happen in one DB transaction or unique constraint; a replay cannot double-spend.
6. **Fee ceiling enforced.** Signed gas limit/price never exceeds the quoted ceiling; providers that cannot enforce it fail closed.
7. **No secret handling.** No private key, seed, PIN or entity secret in code, logs, errors or commits. Errors carry codes, not payloads.
8. **Flags.** `HODD_*_EXECUTION_ENABLED` stays off in production/Vercel and on non-loopback hosts. No mainnet chain ids or real-money addresses.
9. **Tests.** Each rule above has a test, including the failure path.
