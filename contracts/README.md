# Hodd vault contracts (`HoddieVault`)

A non-custodial alternative to Hodd's custodial Autopilot: one small vault contract per user.
The **user's own wallet is the `owner`**. Hodd's existing Circle agent wallet is only a **limited
`operator`**. The funds sit in the vault, never in a wallet that Hodd's server can spend freely.

Target chain: **Arc Testnet** (chain id `5042002`, RPC `https://rpc.testnet.arc.network`).
Asset: USDC at `0x3600000000000000000000000000000000000000` (6 decimals; on Arc this ERC-20
interface is a view of the native balance).

```
contracts/
  src/HoddieVault.sol             the per-user vault (not upgradeable)
  src/HoddieVaultFactory.sol      CREATE2 factory, one deterministic address per parameter set
  src/HoddUSYCVault.sol           the pooled, Hodd-wide USYC vault (see "HoddUSYCVault" below)
  src/interfaces/                 ITeller, IRolesAuthority (the slice of Circle's contracts it uses)
  script/DeployFactory.s.sol      forge script, reads the deployer key from the environment
  script/DeployHoddUSYCVault.s.sol  forge script for the pooled USYC vault
  test/                           unit, fuzz, invariant, fork and script tests (+ mocks)
  test/pool/                      the HoddUSYCVault suites
  lib/                            forge-std v1.17.0, openzeppelin-contracts v5.7.0 (git submodules)
```

Two separate contracts: `HoddieVault` (per user, holds USDC, the agent is a limited operator) and
`HoddUSYCVault` (one pooled vault Circle allowlists, so that users never have to be allowlisted).
The agent invests in USYC only through `HoddieVault -> HoddUSYCVault`, which is a normal ERC-4626
strategy for the `HoddieVault`; the `HoddieVault` never holds USYC and never talks to the Teller.

> **Status: testnet-grade, unaudited.** Do not hold real value in these contracts before an
> independent audit. See "Before mainnet" at the end.

## What the contracts do

`HoddieVault` holds USDC for its owner and lets the operator move it only to places the owner
allowed:

| Who | Can do |
| --- | --- |
| **Operator** (Hodd agent wallet) | `depositToStrategy` into an owner-allowlisted ERC-4626 strategy (deposit budget); `withdrawFromStrategy` / `redeemFromStrategy` back **into the vault** (not limited, funds stay in custody); `redeemToOwner`: redeem and forward the USDC **straight to the owner** in the same transaction (not limited); `transferToOwner` (not limited); `pay` an owner-approved recipient, within that recipient's own cap, with a bill reference (payment budget). Every strategy call carries a slippage bound checked on the vault's real balances. All of these stop while the vault is paused. |
| **Owner** (user wallet, EOA or ERC-1271 smart account) | Everything else, also when paused and also when there is no operator: `pause`/`unpause`, `setLimits`, `setOperator`/`revokeOperator`, `allowStrategy`/`disallowStrategy`, `addRecipient`/`removeRecipient`, `invalidateNonce`, **`withdrawAll`**, `exitStrategy`, `rescueToken`, and two-step ownership transfer (`Ownable2Step`). |
| **Anyone** (Hodd's server pays the gas) | `addRecipientWithSig`: submit an owner-signed EIP-712 `AddRecipient` message. Nothing else. |

What the operator can **never** do: choose a receiver other than the vault, the owner or an
approved recipient; touch a strategy that is not allowlisted; exceed the per-transaction or
rolling-24-hour limit on deposits or on payments, or a recipient's cap; change any setting; or stop the owner from
withdrawing. What the owner can **always** do, regardless of Hodd being up, down or hostile:
`withdrawAll()`.

The vault has no `receive`/`fallback`, so native value sent with a call reverts. Ownership can
not be renounced (that would lock the funds), `renounceOwnership()` reverts.

### Limits

Two separate budgets (USDC base units): **strategy deposits** (`maxDepositPerTx`, `depositLimit24h`)
and **payments** (`maxPaymentPerTx`, `paymentLimit24h`), plus a **per-recipient cap** set when the
owner approves a recipient (`addRecipient(recipient, maxPerPayment)` or the signed variant). The
24-hour limits are a **rolling window** in hourly buckets (`src/RollingWindow.sol`): a spend counts for
at least 24 hours and less than 25, so no amount can be spent twice around midnight or any other
boundary. `setLimits` does not reset what was already spent. Withdrawals, redemptions and
`transferToOwner`/`redeemToOwner` are not limited because the money stays with the owner or in the
vault. Setting a limit to `0` freezes that budget; the 24-hour limits must fit in `uint64`.

### `withdrawAll()` and Morpho Vault V2

For every allowlisted strategy the vault holds shares of, it (1) tries to **redeem all shares into
the vault**, (2) if that reverts, redeems `maxRedeem` shares, and forwards exactly the USDC that
arrived (measured by balance) to the owner in the same call, (3) sends whatever shares are left to
the owner **as share tokens** where they can be transferred, so the owner can redeem later. Then all
idle USDC goes to the owner. Redeeming into the vault (never to a foreign receiver) is what Hodd's
USYC pool requires: it pays only the share holder and its shares can not be moved. Every strategy
interaction is a guarded low-level call that never copies more than 32 bytes of return data: a
strategy that reverts, returns garbage, has no code or returns a huge payload is skipped
(`StrategyExitFailed`) and cannot block the others.

Step (1) comes first on purpose: the allowlisted Morpho vault is a **Vault V2**, and V2 returns
`0` from `maxDeposit/maxMint/maxWithdraw/maxRedeem`. A `maxRedeem`-first implementation would
hand the user share tokens instead of USDC. The fork test proves the real vault returns USDC.

If a strategy burns all gas (`invalid`), `withdrawAll` can run out of gas. The escape hatches
are constant-cost: `disallowStrategy(bad)` (never reverts, never touches the strategy) and
`exitStrategy(good)` per strategy.

### Removing a strategy never strands shares

`disallowStrategy` only removes the address from the allowlist (the operator can no longer use
it, `withdrawAll` no longer visits it). Shares stay in the vault and remain reachable by the
owner through `exitStrategy(strategy)` (works for any address) or `rescueToken(shares, amount)`
(always sent to the owner).

### Adding a recipient with a signature

The owner signs EIP-712 typed data, domain `("HoddieVault", "1", chainId, vaultAddress)`:

```
AddRecipient(address recipient,uint256 nonce,uint256 deadline)
```

`nonce` is `vault.nonces(owner())`. The contract verifies with OpenZeppelin
`SignatureChecker.isValidSignatureNow(owner(), digest, signature)`, so it accepts ECDSA
signatures from an EOA **and** ERC-1271 signatures from a deployed smart account. The nonce is
consumed on success, a signature is valid until `deadline` (inclusive), works once, and only for
the owner at submission time. `invalidateNonce()` cancels an unsubmitted signature.

```ts
// viem
const nonce = await publicClient.readContract({ address: vault, abi, functionName: "nonces", args: [owner] });
const signature = await walletClient.signTypedData({
  account: owner,
  domain: { name: "HoddieVault", version: "1", chainId: 5042002, verifyingContract: vault },
  types: { AddRecipient: [
    { name: "recipient", type: "address" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ] },
  primaryType: "AddRecipient",
  message: { recipient, nonce, deadline },
});
// Hodd's server then submits: vault.addRecipientWithSig(recipient, deadline, signature)
```

`vault.addRecipientDigest(recipient, deadline)` returns the exact digest for the current nonce.

**Smart-account owners (Circle passkey MSCA).** The vault calls `isValidSignature(digest, sig)`
on the owner with the *raw* EIP-712 digest. Some modular accounts wrap the hash first
(ERC-7739 style "replay-safe" signatures). Such an account will reject the plain digest and the
signature path will not work for it. This must be tested once with the real Circle account
before the UI depends on it. The fallback always works: the smart account calls `addRecipient`
itself (a UserOperation). The owner account must be **deployed**; a counterfactual account can
not validate signatures.

### Arc specifics

* USDC is the native coin (18 decimals) and its ERC-20 view (`0x3600...`, 6 decimals) is the same
  balance. A USDC `transfer` into the vault moves the balance without running vault code, so the
  vault needs no `receive()` (checked against the live node with `eth_call`: a transfer into a
  contract without `receive` succeeds, a call with native value reverts). Native dust below
  `1e-6` USDC can not be moved through the ERC-20 interface.
* Circle's USDC blocklist is enforced by the chain. If the owner or the vault were blocklisted,
  USDC transfers to/from them revert; nothing in the contract can change that.
* Block timestamps are non-decreasing (not strictly increasing). The vault only uses
  `timestamp / 1 days` and `timestamp > deadline`, which tolerate that.
* Minimum base fee is 20 gwei; transactions with a lower `maxFeePerGas` are silently dropped.

### `HoddieVaultFactory`

`createVault(owner, operator, limits, strategies)` deploys
`new HoddieVault{salt}(...)` with `salt = keccak256(abi.encode(owner, operator, limits,
strategies))` (see `HoddieVaultAddress`). The CREATE2 address commits to the factory, the asset and every
constructor argument, so a front-runner can not occupy the address Hodd predicts with other
parameters: other parameters give another address. Creation is permissionless, anyone can create
the same vault for an owner (it is exactly the vault the owner asked for) and a second creation of
identical parameters reverts with `VaultAlreadyDeployed`. `predictVault(...)` returns the address
before it exists, `isVault(address)` tells whether the factory created it.

**Never trust "created by the factory" alone.** Anyone can create a vault that names *you* as owner
with a hostile operator or strategy. Before showing a vault to a user or asking for a deposit,
read `owner()`, `operator()`, the four limits, `strategies()` on-chain and compare
them with what the user agreed to. Index `VaultCreated` only for predicted addresses.

## Tests

Requires [Foundry](https://book.getfoundry.sh/) (`forge` 1.x).

```bash
cd contracts
forge build
forge test                                   # unit + fuzz + invariant (fork tests skip), ~35 s
forge test --gas-report                      # add --match-contract HoddieVaultTest for clean numbers
forge fmt --check
forge test --match-contract Fork --fork-url https://rpc.testnet.arc.network     # live Arc Testnet
# alternate RPC if the public one rate-limits: https://rpc.testnet.arc.io
```

| Suite | File | What it covers |
| --- | --- | --- |
| Unit | `test/HoddieVault.t.sol`, `test/HoddieVaultFactory.t.sol`, `test/pool/HoddieVaultUsycPool.t.sol` | every function, every permission failure (owner / operator / stranger), pause, both budgets and the rolling window with `vm.warp`, recipient caps, slippage bounds, events, native value, signatures (EOA, ERC-1271 mock, wrong signer, expired, replay, wrong vault/chain, wrong cap), ownership migration, reentrancy, hostile strategies; with the real HoddUSYCVault: `redeemToOwner`, exits without the operator, a blocked pool, a partial exit under Circle's daily limit |
| Fuzz | `test/HoddieVault.fuzz.t.sol` (1000 runs) | amounts, limits, timestamps vs a model, signatures, strangers |
| Invariant | `test/invariant/` (6 properties) | random operator/owner/stranger calls against OZ ERC-4626 mocks (normal, Morpho-V2-like, capped, blocked, share-locked), a hostile strategy and the real HoddUSYCVault over the mock Teller (Circle allowlist, prices, fees, limits and liquidity changing at random) |
| Fork | `test/fork/HoddieVault.fork.t.sol`, `test/pool/HoddUSYCVaultHoddie.fork.t.sol` | real Arc USDC + real Morpho Vault V2; a `HoddieVault` using the pool on the real Teller (`redeemToOwner`, `withdrawAll` without the operator, a pool removed from Circle's allowlist and restored) |
| Script | `test/DeployFactory.t.sol` | the deploy script |

Invariants: (1) USDC and shares only ever reach the owner, approved recipients or allowlisted
strategies, USYC only sits in the pool, and the supply is conserved; (2) over any 24 hours
deposits and payments each stay within their limit, no call exceeds its per-call cap or a
recipient's cap, and the windows equal an independent model; (3) `withdrawAll` never reverts, leaves
no USDC in the vault and delivers all idle USDC plus everything redeemable to the owner (the pool
pays exactly its own preview); (4) a stranger never changes state and only valid owner signatures
count; (5) every slippage bound holds on real balances; (6) `redeemToOwner` forwards exactly the
redeemed USDC and never touches idle USDC or the budgets. The suites were checked with deliberate bugs (mutation checks): removing a
limit check, an access check, the idle sweep, the day reset, or the guarded strategy call each
makes an invariant fail.

### About the fork test

Stock Foundry runs a plain EVM. Arc's USDC token delegates its bookkeeping to native-coin
precompiles (`0x1800...0000`: `totalSupply`, `mint`, `burn`, `transfer(from,to,amount)`, and
`0x1800...0001`: `isBlocklisted`) that a plain EVM does not have. `test/fork/ArcNativeCoinMock.sol`
installs small stand-ins at those two addresses with `vm.etch` (balances are moved with `vm.deal`).
Everything else is the live code and state: the USDC proxy and implementation, the Morpho Vault V2,
its adapter and markets. USDC is funded with `vm.deal` (Arc's USDC has no balance storage, so
Foundry's ERC-20 `deal` can not work). Arc's own tooling (`arc-forge`, `arc-anvil`) simulates the
real precompiles and is the faithful alternative if you install it. The tests skip cleanly when no
fork URL is given.

## Deployment (not done yet)

Nothing has been deployed. Both ways below deploy **only the factory**. Vaults are created later
through the factory.

### (a) `forge script` with a key from the environment

```bash
cd contracts
# the key is read at run time from the environment; never commit it, never put it in a file in git
export DEPLOYER_PRIVATE_KEY=0x...        # from your secret manager

# 1. dry run (simulation only, nothing is sent)
forge script script/DeployFactory.s.sol:DeployFactory --rpc-url https://rpc.testnet.arc.network

# 2. broadcast and verify on ArcScan in one go
forge script script/DeployFactory.s.sol:DeployFactory \
  --rpc-url https://rpc.testnet.arc.network \
  --broadcast --with-gas-price 25gwei \
  --verify --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/
```

The deployer needs testnet USDC for gas (the native coin on Arc). The script refuses to run on any
chain except Arc Testnet unless `ALLOW_OTHER_CHAIN=true`, and checks that the asset has 6 decimals.
`USDC_ADDRESS` overrides the asset (default `0x3600...`). `--with-gas-price 25gwei` keeps the
transaction above Arc's 20 gwei minimum base fee. Output lands in `contracts/broadcast/`
(git-ignored).

### (b) Circle Contracts (Smart Contract Platform) from ABI + bytecode

Deploys the factory from a Circle **developer-controlled wallet on `ARC-TESTNET`** (the same kind
of wallet Hodd already uses as the agent wallet). Docs: the
[deploy contract API](https://developers.circle.com/api-reference/contracts/smart-contract-platform/deploy-contract)
and the [Node.js SDK](https://developers.circle.com/sdks/contracts-nodejs-sdk)
(`@circle-fin/smart-contract-platform`, Node 22+). **Do not add the dependency to the app for this**;
run it from a throwaway directory.

1. Get ABI and creation bytecode from the compiled artifacts:

   ```bash
   cd contracts && forge build
   forge inspect HoddieVaultFactory abi --json  > /tmp/factory.abi.json
   forge inspect HoddieVaultFactory bytecode    > /tmp/factory.bytecode.txt   # 0x... creation code
   ```

2. Call `deployContract`. Request fields (`POST https://api.circle.com/v1/w3s/contracts/deploy`):
   `idempotencyKey` (UUID), `name` (alphanumeric only), `walletId`, `abiJson` (the ABI as a
   **JSON string**), `bytecode` (`0x...`), `constructorParameters` (ordered array),
   `feeLevel` (`LOW|MEDIUM|HIGH`) or explicit `gasLimit` + `maxFee` + `priorityFee`, plus
   `entitySecretCiphertext` (the SDK fills that in). `ARC-TESTNET` is a valid blockchain value;
   with `walletId` the chain comes from the wallet.

   ```js
   // deploy-factory.mjs   (npm i @circle-fin/smart-contract-platform, in a scratch folder)
   import { initiateSmartContractPlatformClient } from "@circle-fin/smart-contract-platform";
   import { readFileSync } from "node:fs";

   const client = initiateSmartContractPlatformClient({
     apiKey: process.env.CIRCLE_API_KEY,
     entitySecret: process.env.CIRCLE_ENTITY_SECRET,
   });

   const res = await client.deployContract({
     name: "HoddieVaultFactory",
     description: "Hodd non-custodial vault factory",
     walletId: process.env.CIRCLE_WALLET_ID,                       // developer-controlled wallet, ARC-TESTNET
     abiJson: readFileSync("/tmp/factory.abi.json", "utf8"),       // string, not an array
     bytecode: readFileSync("/tmp/factory.bytecode.txt", "utf8").trim(),
     constructorParameters: ["0x3600000000000000000000000000000000000000"],   // asset = USDC
     feeLevel: "MEDIUM",
   });
   console.log(res.data);  // { contractId, transactionId }
   ```

3. The call only *initiates* the deployment. Poll the transaction (`GET /v1/w3s/transactions/{id}`
   or the wallets SDK `getTransaction`) until `COMPLETE`, then read the address from the contract
   (`GET /v1/w3s/contracts/{contractId}` -> `contractAddress`).
4. Verify on ArcScan (below), then run the post-deploy checks.

Notes: the agent wallet that Hodd already runs sets explicit gas limits and a 20 gwei floor (see
`agentFeeConfig` in `src/lib/autopilot/calls.ts`); an SCA wallet with Gas Station is the other
option Circle documents for Arc Testnet. The factory's creation code is ~13.5 KB, so expect a
deploy gas of roughly 3 M (set the gas limit with headroom).

Creating a vault later (permissionless, any funded wallet) with the same wallet kind, in the style
the app already uses:

```ts
const callData = encodeFunctionData({ abi: factoryAbi, functionName: "createVault",
  args: [owner, operator, 1_000_000_000n /* 1000 USDC per tx */, 5_000_000_000n /* per day */, [MORPHO_VAULT]] });
await devc.createContractExecutionTransaction({
  walletId, contractAddress: FACTORY, callData, amount: "0", idempotencyKey, refId,
  fee: agentFeeConfig(gasLimit, gasPriceCeilingWei, priorityWei),   // createVault ~2.3 M gas
});
```

Predict the address first (read-only):

```bash
cast call $FACTORY "predictVault(address,address,uint256,uint256,address[])(address)" \
  $OWNER $OPERATOR 1000000000 5000000000 "[0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88]" \
  --rpc-url https://rpc.testnet.arc.network
```

### Verifying on ArcScan

`https://testnet.arcscan.app` redirects (301) to **`https://explorer.testnet.arc.io`**, which is a
**Blockscout** instance (backend v12, Etherscan-compatible `/api` endpoint, Solidity 0.8.28 and EVM
`cancun` supported). So Foundry's `blockscout` verifier works, no API key needed:

```bash
cd contracts
forge verify-contract <FACTORY_ADDRESS> src/HoddieVaultFactory.sol:HoddieVaultFactory \
  --chain-id 5042002 \
  --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/ \
  --compiler-version 0.8.28 --num-of-optimizations 200 --evm-version cancun \
  --constructor-args $(cast abi-encode "constructor(address)" 0x3600000000000000000000000000000000000000) \
  --watch
```

A vault created by the factory is verified the same way (it embeds per-instance immutables, so do
not expect Blockscout to copy verification from another vault):

```bash
forge verify-contract <VAULT_ADDRESS> src/HoddieVault.sol:HoddieVault \
  --chain-id 5042002 --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/ \
  --compiler-version 0.8.28 --num-of-optimizations 200 --evm-version cancun \
  --constructor-args $(cast abi-encode "constructor(address,address,address,uint256,uint256,address[])" \
     0x3600000000000000000000000000000000000000 $OWNER $OPERATOR 1000000000 5000000000 "[0xAabb...]") --watch
```

Fallback if the CLI verifier misbehaves: `forge verify-contract <addr> <path:Contract> --show-standard-json-input`
prints the standard-JSON input, which can be uploaded in the Blockscout "Verify & publish" form
(method "Solidity (Standard JSON input)", compiler `v0.8.28+commit.7893614a`, EVM `cancun`).
These commands were prepared and syntax-checked locally but not run against a deployed contract.

### Post-deploy checks

1. `cast call $FACTORY "asset()(address)"` is `0x3600...0000`.
2. `predictVault(...)` equals the address returned by `createVault(...)`.
3. On the new vault: `owner()`, `operator()`, the four limits and `strategies()` are exactly
   what was agreed; `paused()` is false.
4. Smoke test with a few cents of testnet USDC: ERC-20 `transfer` into the vault, operator
   `depositToStrategy`, `withdrawFromStrategy`, owner `withdrawAll`. Also test the signature path with
   the real owner wallet type (EOA and Circle passkey account).

## Before mainnet (not implemented, deliberately)

Separate limits for strategy deposits and for payments; per-recipient caps; a timelock (or at
least a delay) on limit increases and on adding recipients/strategies; a guardian role that can
only pause; an operator-triggered emergency pause; a maximum share of funds per strategy;
`minShares`/`minAssets` slippage arguments on the operator calls; an on-chain strategy registry
maintained by Hodd and an owner-visible "approved by Hodd" flag; a per-owner salt in the factory so a
user can have several vaults with identical parameters; an ERC-7739-aware signature path for
smart-account owners; and an independent audit.

---

# `HoddUSYCVault`: the pooled, Hodd-wide USYC vault

Circle's USYC (a tokenized money-market fund) is **permissioned**: the Teller that sells it and the
token itself only talk to addresses on Circle's allowlist (`RolesAuthority`, role 0). Hodd's users
are not on that list, and they should not have to be. `HoddUSYCVault` is **one contract that Circle
allowlists once**. Users deposit only **USDC** and withdraw only **USDC to their own address**; the
contract subscribes to, holds and redeems the USYC internally.

```
user (USDC) --deposit--> HoddUSYCVault --Teller.deposit--> USYC held by the pool
user (USDC) <--redeem--- HoddUSYCVault <--Teller.redeem--- USYC
```

It is an ERC-4626 vault over USDC, so a `HoddieVault` can use it as an ordinary strategy (this is the
only way Hodd's agent invests in USYC; the `HoddieVault` never holds USYC and never talks to the
Teller). It is non-upgradeable, solc 0.8.28, OpenZeppelin v5.7, 8.8 KB of runtime code.

## External API

| Function | Notes |
| --- | --- |
| `deposit(assets, receiver)` / `deposit(assets, receiver, minShares)` | pulls USDC from the caller, subscribes, mints shares to `receiver` |
| `redeem(shares, receiver, holder)` / `redeem(shares, receiver, holder, minAssets)` | `msg.sender == receiver == holder` only; returns exactly the USDC the holder received |
| `reinvestIdle()` | permissionless: subscribes idle USDC (gifts) for the whole pool, mints nothing |
| `pauseDeposits()` `unpauseDeposits()` `setDepositCaps(perTx, total)` | admin (`Ownable2Step`), nothing else |
| `mint` `withdraw` `previewMint` `previewWithdraw` | revert `NotSupported`; `maxMint` / `maxWithdraw` are 0 |
| `transfer` `transferFrom` `approve` | revert `SharesNotTransferable` |
| views | `asset` `totalAssets` `convertToShares` `convertToAssets` `previewDeposit` `previewRedeem` `maxDeposit` `maxRedeem` `usycHeld` `usycOf(shares)` `usdc` `teller` `usyc` `authority` `depositsPaused` `maxDepositPerTx` `maxTotalAssets` `OFFSET` (the guarded ones never revert) |
| events | ERC-4626 `Deposit` / `Withdraw` plus `UsycSubscribed(user, receiver, usdcIn, usycIn, shares)`, `UsycRedeemed(user, shares, usycOut, usdcOut)`, `IdleReinvested`, `DepositsPaused`, `DepositsUnpaused`, `DepositCapsUpdated` |

Constructor: `(IERC20 usdc, ITeller teller, IERC20 usyc, IRolesAuthority authority, address admin)`,
reverts unless `teller.asset() == usdc`, `teller.share() == usyc` and both tokens have 6 decimals. All
four addresses are immutable. The caps start at 1,000 USDC per deposit and 100,000 USDC in total.

## How shares work, and the deliberate deviations from ERC-4626

1. **Shares follow the USYC actually received, never an oracle quote.** On `deposit` the vault
   measures its USYC balance delta and mints `shares = usycIn * (supply + 10**6) / (usycHeld + 1)`.
   Reason: the Teller prices a subscription at the *next* price when the oracle price is stale or
   after the 14:00 New York cut-off, while `convertToAssets` uses the current one. Minting from the
   NAV would let a depositor buy in at a price the pool does not get and dilute everybody. On
   `redeem`, `usycOut = shares * (usycHeld + 1) / (supply + 10**6)`. Both round **down** (towards the
   pool), so a holder never takes out more than pro rata.
2. **Virtual shares.** The `10**6` virtual shares and the `+1` virtual USYC unit (OZ style) make the
   inflation/donation attack unprofitable: share decimals are 12 (USYC's 6 plus `OFFSET = 6`), and
   an attacker who donates to inflate the price loses about `10**6` times more than he can steal.
   `supply <= 10**6 * usycHeld` holds from the first deposit on, so the USYC claimed by all shares
   never exceeds the USYC held (an invariant test checks it). The virtual position keeps a tiny share
   (`10**6 / (supply + 10**6)`) of any gift: tens of base units (thousandths of a cent) even after a
   gift 40 times the size of a 500 USDC pool.
3. **`redeem` pays only the holder**, to the holder's own address: `msg.sender == receiver ==
   holder`. No allowance-based redemption, no third-party receiver. The Teller pays the USDC to the
   (allowlisted) vault, which measures the USDC delta and forwards exactly that. The return value is
   that exact delta, so a caller can verify it from its own balance.
4. **Shares are non-transferable.** They are a claim only the holder can redeem.
5. **`mint` and `withdraw` are not supported.** What a number of shares fetches is only known at
   redemption time. `maxMint` / `maxWithdraw` return 0 so the vault stays ERC-4626-consistent.
6. **`totalAssets`, `convertToShares`, `convertToAssets` are informational**: the USYC at the Teller's
   latest price plus idle USDC. `previewDeposit` and `previewRedeem` use the Teller's own quote
   (`previewDepositData`, `previewRedeemData`), so they price exactly like the real operation.
7. **Slippage overloads** (`minShares`, `minAssets`) on both `deposit` and `redeem`.
8. **Redemptions can never be paused.** Not by the admin, not by anyone.

`maxDeposit` is 0 when deposits are paused, a cap is reached, the Teller's subscription limit for the
vault is used up, or Circle does not currently permit the vault (not allowlisted, authority paused or
unreadable). `maxRedeem(holder)` is the holder's shares bounded by the Teller's own `maxRedeem` (daily
redemption limit and treasury liquidity), converted to shares, and 0 if Circle does not permit the
vault. Every view is guarded and never reverts.

## Idle USDC, donations, inflation attacks

Share value is measured in **USYC only**, so sending USDC to the vault cannot move the share price:
it is idle until anyone calls `reinvestIdle()`, which subscribes it for the whole pool (a gift to all
holders pro rata, no shares minted; it can neither be stolen by the next depositor nor lost). USYC can
only be sent by allowlisted senders and is a gift to all holders too. Subscribing a gift costs the
Teller's next-price spread like any subscription. The first-depositor/inflation attack is covered
by the virtual shares (see above and `testFuzz_inflationAttackNeverPays`).

## Trust model

* **Users** trust the contract, not Hodd: nobody, including the admin, can move, freeze, transfer or
  redeem their shares, or send their USDC anywhere but their own address.
* **The admin** (Hodd's ops key, `Ownable2Step`, `renounceOwnership` disabled) can only pause/unpause
  **new deposits** and set the two **deposit caps** (`maxDepositPerTx`, `maxTotalAssets`). The caps
  are pool-level on purpose: they bound the pilot's total exposure, and a per-account cap would be
  trivially sidestepped with more addresses. The admin can not change the Teller, USYC or the
  authority (immutable) and can not touch redemptions.
* **Circle** controls the allowlist, the oracle price, fees, the daily limits and the treasury.

### Circle-side risks (testnet only)

* If Circle **removes the vault from the allowlist or pauses its `RolesAuthority`**, deposits and
  redemptions revert until it is restored. Shares stay valid claims; nothing is lost, redemptions
  just wait. (`deposit` then reverts `NotPermittedByCircle`; `redeem` bubbles the Teller's own
  `NotPermissioned` / `NoAccess`. `redeem` deliberately has no pre-check, so a wrong guess of ours can
  never block a redemption the Teller would allow.)
* The Teller's **daily subscription/redemption limits and its treasury liquidity are shared by every
  user** of the pool (the Teller sees one account, the vault). Today's default limit is 1,000,000
  USDC per day each. One large redeemer can use up the day for everyone.
* **Fees and the next-price spread** are borne by the user whose operation triggers them. Measured on
  the live Teller: a deposit followed by an immediate redemption returns about 0.04 % less
  (the subscription is priced at the next price while the oracle price is stale or after the cut-off).
  Fees are 0 today.
* **Pooled exposure for non-allowlisted users needs Circle's explicit approval** before any
  mainnet use. This contract is testnet-grade and unaudited.

## Using it as a `HoddieVault` strategy

The final `HoddieVault` treats the pool like any ERC-4626 strategy and never holds USYC itself:
`depositToStrategy(pool, assets, minShares)` (`deposit(assets, vault)`), `redeemFromStrategy` into the
vault, and `redeemToOwner(pool, shares, minAssets)`, which redeems to the vault and forwards exactly the
USDC that arrived to the owner in the same transaction. `withdrawFromStrategy` reverts
(`NotSupported`). The owner's `withdrawAll` / `exitStrategy` redeem the pool shares to the vault and
forward the USDC, without the operator and while paused. While Circle does not permit the pool (or
USYC is paused) the pool shares stay in the `HoddieVault` (`StrategyExitFailed`) and everything else
still leaves; once Circle restores the pool, `exitStrategy(pool)` takes them out. Only the pool needs
Circle's allowlist: neither the `HoddieVault` nor its owner does. Mind the pool's per-deposit cap
(`maxDepositPerTx`, 1,000 USDC by default) when sizing operator deposits.

## Tests

```bash
cd contracts
forge test                                   # unit + fuzz + invariants (fork tests skip), ~45 s
forge test --match-contract HoddUSYCVault    # the pool only
forge test --match-contract Fork --fork-url https://rpc.testnet.arc.network   # live Arc Testnet
```

| Suite | File | What it covers |
| --- | --- | --- |
| Unit (50) | `test/pool/HoddUSYCVault.t.sol` | every path and revert, share math, non-transferability, admin limits, paused deposits never block redemptions, Circle-side failures (allowlist, paused authority, daily limits, illiquid treasury), views never revert, donations, reentrancy |
| Fuzz (9, 1000 runs) | `test/pool/HoddUSYCVault.fuzz.t.sol` | rounding (no one redeems more USDC-worth of USYC than contributed), pro-rata fairness with several users and price moves incl. next-price subscriptions, gifts, previews, split redemptions, the inflation attack |
| Invariants (5) | `test/pool/HoddUSYCVault.invariant.t.sol` | USYC held covers every claim; redeem pays only the holder the exact pro-rata amount; the admin can never change a balance; a stranger can not change state; USYC and USDC accounting balances |
| Fork | `test/pool/HoddUSYCVault.fork.t.sol`, `test/pool/HoddUSYCVaultHoddie.fork.t.sol` | the real Teller/USYC/RolesAuthority: a NON-allowlisted wallet deposits and redeems USDC after the vault is allowlisted by impersonating the authority owner; a not-allowlisted pool (`maxDeposit` 0, clean revert); removal from the allowlist, paused authority, shared daily limits; the clean `HoddieVault` using the pool as a strategy |

The mock Teller / USYC / RolesAuthority in `test/mocks/MockTeller.sol` enforce the allowlist exactly
like Circle's contracts (caller and receiver checks, two-user checks on redeem, `canCall` reverting
while the authority is paused). The fork tests need the Arc precompile stand-ins described in the
fork section above.

## Deploying `HoddUSYCVault`

**Deployed on Arc Testnet (2026-10-13):** [`0x97A7BAaA5416e0aC0674C395cec22FF606120b76`](https://explorer.testnet.arc.io/address/0x97A7BAaA5416e0aC0674C395cec22FF606120b76)
(source verified on ArcScan). Admin: `0x93A7F9a958171303DE74Ab7f6778D25F96316564`. Caps raised after
deployment with `setDepositCaps` to 100,000 USDC per deposit and 1,000,000 USDC in total
(tx `0x5ac53fd937233179d650a25589b2290d8136fbe1d52167d7c22efde9f6f12650`). Waiting for Circle to
allowlist it (until then `maxDeposit` is 0 and deposits revert `NotPermittedByCircle`).

```bash
cd contracts
export PRIVATE_KEY=0x...     # deployer, read at run time from the environment, never written anywhere
export ADMIN=0x...           # Hodd's ops key: may only pause deposits and set the caps

forge script script/DeployHoddUSYCVault.s.sol:DeployHoddUSYCVault \
  --rpc-url https://rpc.testnet.arc.network                      # dry run
forge script script/DeployHoddUSYCVault.s.sol:DeployHoddUSYCVault \
  --rpc-url https://rpc.testnet.arc.network --broadcast --with-gas-price 25gwei \
  --verify --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/
```

The script uses Arc Testnet's USDC `0x3600...0000`, Teller `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A`,
USYC `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` and RolesAuthority
`0xCC205224862C7641930c87679E98999d23C26113`; it refuses any other chain unless
`ALLOW_OTHER_CHAIN=true`. The constructor itself checks `teller.asset()`/`teller.share()`.

Verify on ArcScan (`testnet.arcscan.app` redirects to the Blockscout at `explorer.testnet.arc.io`):

```bash
forge verify-contract <POOL_ADDRESS> src/HoddUSYCVault.sol:HoddUSYCVault \
  --chain-id 5042002 --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/ \
  --compiler-version 0.8.28 --num-of-optimizations 200 --evm-version cancun \
  --constructor-args $(cast abi-encode "constructor(address,address,address,address,address)" \
    0x3600000000000000000000000000000000000000 0x9fdF14c5B14173D74C08Af27AebFf39240dC105A \
    0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C 0xCC205224862C7641930c87679E98999d23C26113 $ADMIN) --watch
```

Gas on the live Teller (fork): `deposit` about 330 K, `redeem` about 210 K to 230 K, `reinvestIdle`
about 220 K; at Arc's 20 gwei minimum base fee that is well under one US cent each.

### Request to send to Circle with the deployed address

> Subject: Allowlist request: Hodd USYC pool contract on Arc Testnet
>
> Hi Circle team, Hodd is building a USDC-in / USDC-out pooled vault so that our users can hold USYC
> exposure without each of them having to be allowlisted. The contract below is the only party that
> ever subscribes to, holds or redeems USYC; users deal in USDC only, shares are non-transferable and
> redeemable only by their holder to their own address. Could you please allowlist this address on
> Arc Testnet (`RolesAuthority` `0xCC205224862C7641930c87679E98999d23C26113`, role 0, the same role
> as other investors)?
>
> * Contract: `<POOL_ADDRESS>` (verified source on explorer.testnet.arc.io)
> * Teller `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A`, USYC `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C`
> * It calls `Teller.deposit` and `Teller.redeem` (as itself, with itself as receiver) and holds USYC;
>   it never transfers USYC to anyone.
> * Admin (Hodd ops): `<ADMIN>`. The admin can only pause new deposits and set deposit caps. Initial
>   caps: 1,000 USDC per deposit and 100,000 USDC in total.
> * Testnet only. For any mainnet use we would ask for your explicit approval of the pooled model first.

### Post-deploy checks

1. `cast call <POOL> "teller()(address)"` etc. match the addresses above; `owner()` is the admin.
2. Before Circle acts: `maxDeposit(user)` is 0 and a deposit reverts `NotPermittedByCircle` (clean).
3. After the allowlisting: `maxDeposit(user)` is > 0. Smoke test with a few cents: deposit, then
   redeem everything and check the USDC arrived at the user's own address.
4. Watch `UsycSubscribed` / `UsycRedeemed` / `IdleReinvested` on ArcScan.
