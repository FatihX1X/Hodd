---
name: wallet-smoke
description: Arc Testnet smoke flow with the Hodd test wallet (create wallet, check balances, Earn/Send of at most 1 USDC, ArcScan receipt check). Testnet only.
---

# wallet-smoke

Testnet only (Arc Testnet, chain id 5042002). Never mainnet, never real money, never the user's main wallet.

Test wallet:
- Create once with viem (`generatePrivateKey` + `privateKeyToAccount`) and write `HODD_TEST_WALLET_PRIVATE_KEY=...` to git-ignored `.env.test.local`. Show the user only the PUBLIC address; never print the key to chat or logs. Confirm with `git check-ignore .env.test.local`.
- Record the public address in memory.md.

Flow:
1. Read-only first: balances and vault positions via the read transport (`src/lib/wallet/preflight.ts`); chain id must be 5042002.
2. Balance zero: stop this skill, add "fund test wallet <address> from the Arc faucet" to the Human steps in memory.md, and move on to other work. Do not wait.
3. Funded: run the smallest scenario (at most 1 USDC): Earn deposit, partial withdraw, redeem-all; or Send to a user-owned test recipient. Execution flags only in the local env, loopback host, never production.
4. Verify each tx on ArcScan with the hash and the server receipt verifier; record tx hash + block + ArcScan link in memory.md. A step without an on-chain hash counts as "mock", not "testnet onchain".
5. Browser-approval steps (MetaMask/Rabby popup, Circle PIN, Passkey) cannot be automated: write the exact click-by-click script into memory.md "Human steps" and move on.
