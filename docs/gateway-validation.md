# Circle Gateway validation

Hodd uses Circle Gateway (testnet API `https://gateway-api-testnet.circle.com`, GatewayWallet `0x0077777d7EBA4688BDeF3E311b846F25870A19B9`, GatewayMinter `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B`, Arc domain 26) for three things:

1. **USDC on every chain** (Overview): wallet USDC on 12 EVM testnets plus the Gateway unified balance of the same address. Display only; the Treasury Engine counts Arc funds alone.
2. **Bring USDC to Arc**: optional Gateway deposit on the source chain (exact `approve` + `GatewayWallet.deposit`, never a plain transfer), then a free EIP-712 burn intent. Circle's Forwarding Service submits the Arc mint to the user's own wallet; Hodd verifies it, then offers the normal Morpho deposit within the engine's deposit limit.
3. **Pay from another chain** (Obligations): a payment proposal on the `GATEWAY` rail. Gateway mints the exact obligation amount straight to the Arc recipient; the obligation becomes PAID only after Hodd verifies a GatewayMinter transaction with canonical USDC `Transfer(0x0 → recipient, amount)`.

## Can Gateway mint directly to a third-party recipient? Yes — verified first (2026-10-10)

Depositor: dev test signer `0xB7a07a8184412A160bACe9DA3EeC914c0021a19C`. Third-party recipient: `0x62dCe01b1a7B9a6f592f148d305E0D5751478386`.

| Test | Evidence |
| --- | --- |
| Deposit 1 USDC into Gateway on Arc | `0xb80c0169451e941a10d6bf2f3a4517558191eaaca7aa5d808e81f54be79bb068` (credited within seconds) |
| Arc → Base Sepolia, 0.3 USDC to the recipient, forwarded | transfer `d5ca7ab8-d398-4f1e-a0b0-b442d14514d5`; Base Sepolia mint `0x89c0395fd1b9ef665d6c4d9ebe62ced726198f572efdadf916be881475175177` emits `Transfer(0x0 → recipient, 0.3)`; sent by Circle's forwarder, so the payer needs no destination gas |
| Arc → Arc, 0.2 USDC to the recipient | mint `0x38b25db1b8c96c494a9f902856f33f7c95d549c9aeca89e7ebfd7db3605ecbca`, `Transfer(0x0 → recipient, 0.2)` |
| Hodd's own code (spec, estimate, EIP-712, forwarded submit, mint verification, mint lookup) | `src/lib/gateway/gateway.live.test.ts`, mint `0x5cf7e39c637855a17bbd653c23d60f3539f0c7421eb60949f877c081d75b141d` (block 66470637, 0.05 USDC) |

Fees seen: forwarded 0.1 USDC Arc → Arc capped at 0.021387 (0.0035 base + 0.017887 forwarding); forwarded 0.3 to Base Sepolia capped at 0.056379. The cap (`maxFee`) is taken from the Gateway balance on the source chain on top of the amount; the recipient receives the exact amount.

## One button: deposit and move in one go (2026-10-13)

"Bring USDC to Arc" is now a single button. The user presses it twice: the first press shows "Confirm?" and the second starts the move.

The server quotes the move. If the Gateway balance on the source chain is short of the amount plus fees, the quote also includes the shortfall. It adds an EIP-2612 permit for exactly that amount, made out to the GatewayWallet. The token's own `DOMAIN_SEPARATOR` must match the domain Hodd builds. If it does not, the quote has no permit, and the wallet falls back to approve + deposit.

The wallet then:
1. signs the transfer (free);
2. signs the permit (free);
3. sends one `depositWithPermit` transaction.

The page waits for Gateway to credit the deposit, submits the transfer signed at the start, and verifies the Arc mint. `GatewayWallet.depositWithPermit` and `depositWithAuthorization` are in the deployed implementation on Arc, Base Sepolia, Ethereum Sepolia, Avalanche Fuji and Arbitrum Sepolia (bytecode checked). The burn intent's `maxBlockHeight` from the estimate is days ahead, so an intent signed before the deposit is still valid when it is submitted.

Live evidence uses the dev test signer `0xB7a0…a19C` and `src/lib/gateway/move.live.test.ts`, with Arc as the source:

- **Quote:** Gateway held 0.370776 USDC. Asked for 0.570776; the fee was 0.020679, so the shortfall was 0.220679.
- **Deposit:** one transaction, `0xe20860730edf13b615b1b843fbfaed9fa7aff056fc8497a386f0bdfc3ea78a1e` (gas 113,403). This replaces the approval plus deposit.
- **Credit and transfer:** Gateway credited it within seconds. The intent, signed before the deposit, was submitted as transfer `08c0fa9d-3f33-49df-b7c1-05f3ae70c618`.
- **Mint:** `0x9d2a19104e03a769f3aa799144f01ca945a02cec71a52e500af25ad480100b3f` on Arc (block 67044131), verified as `Transfer(0x0 → signer, 0.570776)`.

## Safety rules in code

- The estimate endpoint must echo the exact spec Hodd built (it answers with 20-byte addresses; words are compared after padding). Hodd signs its own 32-byte spec with Gateway's `maxBlockHeight`/`maxFee`.
- The server verifies the EIP-712 signature against the session wallet before sending it anywhere.
- Own-wallet moves are stateless: an HMAC handle binds user, session, wallet and the exact intent for five minutes, or one hour when the quote includes a deposit (the intent is signed before the deposit and submitted once Gateway credits it).
- Payments reuse the payment ledger (reservation, per-wallet lease, `hodd_finish_payment`). A wallet rejection or a definitive Gateway refusal releases the bill (`FAILED`, nothing sent). A lost answer stays `UNKNOWN`; recheck searches Arc for the mint and may resend the *identical* signed intent, which cannot mint twice. Release needs proof: never signed and expired, or Gateway reports `failed`/`expired` and Arc has no matching mint.
- Gateway signing is EOA-only (MetaMask, Rabby, dev test signer). Circle passkey/PIN wallets see balances only.

## Not verified live

Browser-wallet signing (MetaMask/Rabby `eth_signTypedData_v4`), the deposit step on non-Arc chains (needs that chain's gas token) and the server routes with a signed-in session. Automated tests: `src/lib/gateway/gateway.test.ts`, `src/lib/gateway/payments.test.ts`, `src/lib/gateway/moves.test.ts`, `src/components/gateway-move-dialog.test.tsx`.
