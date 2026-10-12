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
  script/DeployFactory.s.sol      forge script, reads the deployer key from the environment
  test/                           unit, fuzz, invariant, fork and script tests (+ mocks)
  lib/                            forge-std v1.17.0, openzeppelin-contracts v5.7.0 (git submodules)
```

> **Status: testnet-grade, unaudited.** Do not hold real value in these contracts before an
> independent audit. See "Before mainnet" at the end.

## What the contracts do

`HoddieVault` holds USDC for its owner and lets the operator move it only to places the owner
allowed:

| Who | Can do |
| --- | --- |
| **Operator** (Hodd agent wallet) | `depositToStrategy` into an owner-allowlisted ERC-4626 strategy (limited); `withdrawFromStrategy` / `redeemFromStrategy` back **into the vault** (not limited, funds stay in custody); `transferToOwner` (not limited); `pay` an owner-approved recipient with a bill reference (limited). All of these stop while the vault is paused. |
| **Owner** (user wallet, EOA or ERC-1271 smart account) | Everything else, also when paused and also when there is no operator: `pause`/`unpause`, `setLimits`, `setOperator`/`revokeOperator`, `allowStrategy`/`disallowStrategy`, `addRecipient`/`removeRecipient`, `invalidateNonce`, **`withdrawAll`**, `exitStrategy`, `rescueToken`, and two-step ownership transfer (`Ownable2Step`). |
| **Anyone** (Hodd's server pays the gas) | `addRecipientWithSig`: submit an owner-signed EIP-712 `AddRecipient` message. Nothing else. |

What the operator can **never** do: choose a receiver other than the vault, the owner or an
approved recipient; touch a strategy that is not allowlisted; exceed the per-transaction or
per-UTC-day limit on deposits and payments; change any setting; or stop the owner from
withdrawing. What the owner can **always** do, regardless of Hodd being up, down or hostile:
`withdrawAll()`.

The vault has no `receive`/`fallback`, so native value sent with a call reverts. Ownership can
not be renounced (that would lock the funds), `renounceOwnership()` reverts.

### Limits

`maxPerTx` and `dailyLimit` (USDC base units) apply to operator outflows of idle USDC:
strategy deposits and payments share one budget. The window is the UTC day
`block.timestamp / 1 days`; `spentInDay` is reset implicitly when the day changes (no carry-over,
no rolling window). `setLimits` does not reset what was already spent today. `withdraw`, `redeem`
and `transferToOwner` are not limited because the money stays with the owner or in the vault.
Setting either limit to `0` freezes limited outflows.

### `withdrawAll()` and Morpho Vault V2

For every allowlisted strategy the vault holds shares of, it (1) tries to **redeem all shares with
the owner as receiver**, (2) if that reverts, redeems `maxRedeem` shares, (3) sends whatever is
left to the owner **as share tokens** so the owner can redeem later. Then all idle USDC goes to
the owner. Every strategy interaction is a guarded low-level call that never copies more than 32
bytes of return data: a strategy that reverts, returns garbage, has no code or returns a huge
payload is skipped (`StrategyExitFailed`) and cannot block the others.

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

`createVault(owner, operator, maxPerTx, dailyLimit, strategies)` deploys
`new HoddieVault{salt}(...)` with `salt = keccak256(abi.encode(owner, operator, maxPerTx,
dailyLimit, strategies))`. The CREATE2 address commits to the factory, the asset and every
constructor argument, so a front-runner can not occupy the address Hodd predicts with other
parameters: other parameters give another address. Creation is permissionless, anyone can create
the same vault for an owner (it is exactly the vault the owner asked for) and a second creation of
identical parameters reverts with `VaultAlreadyDeployed`. `predictVault(...)` returns the address
before it exists, `isVault(address)` tells whether the factory created it.

**Never trust "created by the factory" alone.** Anyone can create a vault that names *you* as owner
with a hostile operator or strategy. Before showing a vault to a user or asking for a deposit,
read `owner()`, `operator()`, `maxPerTx()`, `dailyLimit()`, `strategies()` on-chain and compare
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
| Unit | `test/HoddieVault.t.sol`, `test/HoddieVaultFactory.t.sol` | every function, every permission failure (owner / operator / stranger), pause, limits incl. day rollover with `vm.warp`, events, native value, signatures (EOA, ERC-1271 mock, wrong signer, expired, replay, wrong vault/chain), ownership migration, reentrancy, hostile strategies |
| Fuzz | `test/HoddieVault.fuzz.t.sol` (1000 runs) | amounts, limits, timestamps vs a model, signatures, strangers |
| Invariant | `test/invariant/` (500 runs x depth 100, 4 properties) | random operator/owner/stranger calls against OZ ERC-4626 mocks (normal, Morpho-V2-like, capped, blocked, share-locked) and a hostile strategy |
| Fork | `test/fork/HoddieVault.fork.t.sol` | real Arc USDC + real Morpho Vault V2 |
| Script | `test/DeployFactory.t.sol` | the deploy script |

Invariants: (1) USDC and shares only ever reach the owner, approved recipients or allowlisted
strategies, and the supply is conserved; (2) operator outflow per UTC day never exceeds
`dailyLimit`, no single outflow exceeds `maxPerTx`; (3) `withdrawAll` never reverts, leaves no USDC
in the vault and delivers all idle USDC plus everything redeemable to the owner; (4) a stranger
never changes state. The suites were checked with deliberate bugs (mutation checks): removing a
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
3. On the new vault: `owner()`, `operator()`, `maxPerTx()`, `dailyLimit()`, `strategies()` are exactly
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
