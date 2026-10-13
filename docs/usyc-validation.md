# USYC pool validation

Hodd's pooled USYC vault, HoddUSYCVault `0x97A7BAaA5416e0aC0674C395cec22FF606120b76` on Arc Testnet, is the only holder of USYC. Circle allowlists this one contract. Users deposit and withdraw only USDC from their own wallet and need no allowlisting. Shares have 12 decimals and cannot be transferred. Only the holder can redeem them, and the USDC is paid to the holder.

## Circle allowlist live (2026-10-13)

Read-only check (`src/lib/usyc/usyc.live.test.ts`):

- Circle permission reads `OK`.
- Deposits are not paused.
- `maxDeposit` is 100,000 USDC per deposit.
- The 1 USDC deposit quote simulated its gas successfully.

## Round trip with Hodd's own code (2026-10-13)

The test signs with the dev test signer `0xB7a07a8184412A160bACe9DA3EeC914c0021a19C` through `src/lib/usyc/usyc.tx.live.test.ts`. It uses the app's quote and verify code, and signs every step inside the quote's gas ceiling.

| Step | Transaction | Result |
| --- | --- | --- |
| Approve exactly 1 USDC to the pool | `0x79f470da7de8d0343f4d0233347bd261e9ed89f7394a0401d987cf2c775b5a51` | verified `CONFIRMED`, gas 55,438 |
| Deposit 1 USDC | `0x1781b12687b12d5b3b71ae2fe4064aa4badc9aa9f6181acb8ead790c2c5a760c` | 876,973,947,747 shares minted (minimum 872,589,130,000), gas 291,367 |
| Withdraw everything | `0x9e9268ce29315dc7cf5aaf8fc1d5453c62459e714635261bc999462bbf439312` | all shares burned; 0.999895 USDC paid to the same wallet (minimum 0.994895), gas 225,607 |

The whole round trip cost 0.028726 USDC:

- **Price spread:** 0.000105 USDC. After-hours pricing was in effect, so the subscribe price was slightly above the redeem price.
- **Network fees:** about 0.0286 USDC for the three transactions.

After the withdrawal the wallet held 0 pool shares.

Run again: `HODD_USYC_TX_LIVE=1 corepack pnpm exec vitest run src/lib/usyc/usyc.tx.live.test.ts --silent=false`. It sends real testnet transactions.
