// @vitest-environment node
import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, getAddress, keccak256, stringToHex, type Hex, type TransactionReceipt } from "viem";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
import {
  billRef, createVaultCall, decodeVaultCall, encodeVaultCall, factoryAbi, HODDIE_VAULT_FACTORY, maxSharesFor, minAssetsFor, minSharesFor,
  vaultAbi, vaultMatches, vaultParams, verifyVaultReceipt, VAULT_LIMITS, VAULT_MORPHO, VAULT_SLIPPAGE_BPS, VAULT_STRATEGIES, VAULT_USYC_POOL,
  type VaultConfig, type VaultInstruction,
} from "./vault";

const owner = getAddress("0x1111111111111111111111111111111111111111");
const operator = getAddress("0x2222222222222222222222222222222222222222");
const vault = getAddress("0x3333333333333333333333333333333333333333");
const recipient = getAddress("0x4444444444444444444444444444444444444444");
const otherVault = getAddress("0x5555555555555555555555555555555555555555");
const stranger = getAddress("0x6666666666666666666666666666666666666666");
const ref = billRef("rent-october");

const instructions: VaultInstruction[] = [
  { fn: "depositToStrategy", strategy: VAULT_MORPHO, assets: 20_000_000n, minShares: 19_900_000n },
  { fn: "withdrawFromStrategy", strategy: VAULT_MORPHO, assets: 6_000_000n, maxShares: 6_030_000n },
  { fn: "redeemToOwner", strategy: VAULT_MORPHO, shares: 30_000_000n, minAssets: 29_850_000n },
  { fn: "transferToOwner", amount: 2_500_000n },
  { fn: "pay", recipient, amount: 10_000_000n, ref },
];

describe("vault operator calls", () => {
  it.each(instructions.map((op) => [op.fn, op] as const))("round-trips %s through encode and decode", (_, op) => {
    const call = encodeVaultCall(vault.toLowerCase(), op);
    expect(call.to).toBe(vault);
    expect(call.value).toBe("0");
    expect(decodeVaultCall(vault, call)).toEqual(op);
    // A call without a value field is treated as zero value.
    expect(decodeVaultCall(vault.toLowerCase(), { to: call.to.toLowerCase(), data: call.data })).toEqual(op);
  });

  it("refuses a call to another vault", () => {
    for (const op of instructions) expect(() => decodeVaultCall(otherVault, encodeVaultCall(vault, op))).toThrow("AGENT_VAULT_CALL_REFUSED");
  });

  it("refuses a call that carries native value", () => {
    for (const value of ["1", "1000000000000000000", "0x0", ""]) {
      expect(() => decodeVaultCall(vault, { ...encodeVaultCall(vault, instructions[3]), value })).toThrow("AGENT_VAULT_CALL_REFUSED");
    }
  });

  it("refuses any strategy other than Morpho, including the allowlisted USYC pool", () => {
    const usyc: VaultInstruction[] = [
      { fn: "depositToStrategy", strategy: VAULT_USYC_POOL, assets: 1_000_000n, minShares: 1n },
      { fn: "withdrawFromStrategy", strategy: VAULT_USYC_POOL, assets: 1_000_000n, maxShares: 2_000_000n },
      { fn: "redeemToOwner", strategy: VAULT_USYC_POOL, shares: 1_000_000n, minAssets: 1n },
      { fn: "depositToStrategy", strategy: stranger, assets: 1_000_000n, minShares: 1n },
    ];
    for (const op of usyc) expect(() => decodeVaultCall(vault, encodeVaultCall(vault, op))).toThrow("AGENT_VAULT_STRATEGY_REFUSED");
  });

  it("refuses owner-only and view functions of the vault", () => {
    const refused: Hex[] = [
      encodeFunctionData({ abi: vaultAbi, functionName: "withdrawAll" }),
      encodeFunctionData({ abi: vaultAbi, functionName: "addRecipient", args: [stranger, 1_000_000_000n] }),
      encodeFunctionData({ abi: vaultAbi, functionName: "setRecipientCap", args: [recipient, 1_000_000_000n] }),
      encodeFunctionData({ abi: vaultAbi, functionName: "owner" }),
      encodeFunctionData({ abi: vaultAbi, functionName: "remainingPaymentAllowance" }),
    ];
    for (const data of refused) expect(() => decodeVaultCall(vault, { to: vault, data, value: "0" })).toThrow("AGENT_VAULT_CALL_REFUSED");
  });

  it("refuses calldata that is not a vault function at all", () => {
    const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [stranger, 1n] });
    expect(() => decodeVaultCall(vault, { to: vault, data: transfer, value: "0" })).toThrow();
    expect(() => decodeVaultCall(vault, { to: vault, data: "0x", value: "0" })).toThrow();
  });

  it("creates the vault through the factory with exactly the predicted parameters", () => {
    const call = createVaultCall(owner.toLowerCase(), operator.toLowerCase());
    expect(call).toMatchObject({ to: HODDIE_VAULT_FACTORY, value: "0" });
    const decoded = decodeFunctionData({ abi: factoryAbi, data: call.data });
    expect(decoded.functionName).toBe("createVault");
    expect(decoded.args).toEqual([owner, operator, { ...VAULT_LIMITS }, [VAULT_MORPHO, VAULT_USYC_POOL]]);
    expect(vaultParams(owner, operator)).toEqual(decoded.args);
  });
});

describe("vaultMatches", () => {
  const config = (): VaultConfig => ({ owner, operator, paused: false, asset: ARC_TESTNET_USDC, limits: { ...VAULT_LIMITS }, strategies: [...VAULT_STRATEGIES] });

  it("accepts exactly the parameters Hodd predicts, whatever the address case", () => {
    expect(vaultMatches(config(), owner, operator)).toBe(true);
    expect(vaultMatches({ ...config(), owner: owner.toLowerCase() as `0x${string}` }, owner.toLowerCase(), operator.toLowerCase())).toBe(true);
  });

  it("refuses another owner, operator or asset", () => {
    expect(vaultMatches(config(), stranger, operator)).toBe(false);
    expect(vaultMatches(config(), owner, stranger)).toBe(false);
    expect(vaultMatches({ ...config(), owner: stranger }, owner, operator)).toBe(false);
    expect(vaultMatches({ ...config(), operator: stranger }, owner, operator)).toBe(false);
    expect(vaultMatches({ ...config(), asset: stranger }, owner, operator)).toBe(false);
  });

  it.each(Object.keys(VAULT_LIMITS) as (keyof typeof VAULT_LIMITS)[])("refuses a different %s", (key) => {
    for (const delta of [1n, -1n]) {
      const changed = config();
      changed.limits = { ...changed.limits, [key]: VAULT_LIMITS[key] + delta };
      expect(vaultMatches(changed, owner, operator)).toBe(false);
    }
  });

  it("refuses strategies in another order, missing, extra or replaced", () => {
    expect(vaultMatches({ ...config(), strategies: [VAULT_USYC_POOL, VAULT_MORPHO] }, owner, operator)).toBe(false);
    expect(vaultMatches({ ...config(), strategies: [VAULT_MORPHO] }, owner, operator)).toBe(false);
    expect(vaultMatches({ ...config(), strategies: [VAULT_MORPHO, VAULT_USYC_POOL, stranger] }, owner, operator)).toBe(false);
    expect(vaultMatches({ ...config(), strategies: [VAULT_MORPHO, stranger] }, owner, operator)).toBe(false);
    expect(vaultMatches({ ...config(), strategies: [] }, owner, operator)).toBe(false);
  });
});

describe("slippage bounds", () => {
  it("allow at most 0.5% loss against the strategy preview", () => {
    expect(VAULT_SLIPPAGE_BPS).toBe(50n);
    expect(minSharesFor(1_000_000n)).toBe(995_000n);
    expect(minAssetsFor(10_000_000n)).toBe(9_950_000n);
    expect(maxSharesFor(1_000_000n)).toBe(1_005_000n);
    // Rounded against the vault: minimums down, maximum up.
    expect(minSharesFor(1_999n)).toBe(1_989n);
    expect(maxSharesFor(199n)).toBe(200n);
    expect(maxSharesFor(1n)).toBe(2n);
  });

  it("never ask for a zero minimum, which the contract rejects", () => {
    for (const value of [0n, 1n, 100n, 200n]) {
      expect(minSharesFor(value)).toBeGreaterThan(0n);
      expect(minAssetsFor(value)).toBeGreaterThan(0n);
    }
    expect(minSharesFor(1n)).toBe(1n);
    expect(minAssetsFor(0n)).toBe(1n);
  });
});

describe("billRef", () => {
  it("is a stable bytes32 per bill and distinct between bills", () => {
    expect(billRef("bill-1")).toBe(billRef("bill-1"));
    expect(billRef("bill-1")).toMatch(/^0x[0-9a-f]{64}$/);
    expect(billRef("bill-1")).toBe(keccak256(stringToHex("hodd-bill:bill-1")));
    expect(new Set(["bill-1", "bill-2", "Bill-1", "bill-1 ", ""].map(billRef)).size).toBe(5);
  });
});

type Log = TransactionReceipt["logs"][number];
const uint = (...values: bigint[]) => encodeAbiParameters(values.map(() => ({ type: "uint256" })), values);
const log = (address: string, topics: readonly (Hex | Hex[] | null)[], data: Hex, logIndex: number) => ({ address, topics, data, logIndex }) as unknown as Log;
const deposited = (strategy: string, assets: bigint, shares: bigint, index = 1, from: string = vault) => log(from, encodeEventTopics({ abi: vaultAbi, eventName: "DepositedToStrategy", args: { strategy: getAddress(strategy) } }), uint(assets, shares), index);
const withdrawn = (strategy: string, assets: bigint, shares: bigint, index = 1) => log(vault, encodeEventTopics({ abi: vaultAbi, eventName: "WithdrawnFromStrategy", args: { strategy: getAddress(strategy) } }), uint(assets, shares), index);
const redeemed = (strategy: string, to: string, shares: bigint, assets: bigint, index = 1) => log(vault, encodeEventTopics({ abi: vaultAbi, eventName: "RedeemedToOwner", args: { strategy: getAddress(strategy), owner: getAddress(to) } }), uint(shares, assets), index);
const transferred = (to: string, amount: bigint, index = 1) => log(vault, encodeEventTopics({ abi: vaultAbi, eventName: "TransferredToOwner", args: { owner: getAddress(to) } }), uint(amount), index);
const payment = (to: string, amount: bigint, paymentRef: Hex, index = 2) => log(vault, encodeEventTopics({ abi: vaultAbi, eventName: "Payment", args: { recipient: getAddress(to), ref: paymentRef } }), uint(amount), index);
const usdcTransfer = (from: string, to: string, value: bigint, index = 1, token: string = ARC_TESTNET_USDC) => log(token, encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: getAddress(from), to: getAddress(to) } }), uint(value), index);
const receipt = (...logs: Log[]) => ({ status: "success" as const, logs });

describe("verifyVaultReceipt", () => {
  const [deposit, withdraw, redeem, toOwner, pay] = instructions as [
    Extract<VaultInstruction, { fn: "depositToStrategy" }>, Extract<VaultInstruction, { fn: "withdrawFromStrategy" }>,
    Extract<VaultInstruction, { fn: "redeemToOwner" }>, Extract<VaultInstruction, { fn: "transferToOwner" }>, Extract<VaultInstruction, { fn: "pay" }>,
  ];
  const mismatch = "AGENT_VAULT_EVENT_MISMATCH";

  it("rejects a reverted receipt before reading any event", () => {
    expect(() => verifyVaultReceipt({ status: "reverted", logs: [deposited(VAULT_MORPHO, deposit.assets, deposit.minShares)] }, vault, owner, deposit)).toThrow("AGENT_VAULT_REVERTED");
  });

  it("accepts the exact strategy deposit and reports the shares received", () => {
    expect(verifyVaultReceipt(receipt(deposited(VAULT_MORPHO, deposit.assets, deposit.minShares)), vault, owner, deposit)).toEqual({ assetsMinor: deposit.assets, shares: deposit.minShares });
    expect(verifyVaultReceipt(receipt(deposited(VAULT_MORPHO, deposit.assets, deposit.minShares + 5n)), vault.toLowerCase(), owner, deposit)).toEqual({ assetsMinor: deposit.assets, shares: deposit.minShares + 5n });
  });

  it("rejects a deposit with another amount, strategy, too few shares, no event or two events", () => {
    expect(() => verifyVaultReceipt(receipt(deposited(VAULT_MORPHO, deposit.assets - 1n, deposit.minShares)), vault, owner, deposit)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(deposited(VAULT_USYC_POOL, deposit.assets, deposit.minShares)), vault, owner, deposit)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(deposited(VAULT_MORPHO, deposit.assets, deposit.minShares - 1n)), vault, owner, deposit)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(), vault, owner, deposit)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(deposited(VAULT_MORPHO, deposit.assets, deposit.minShares, 1), deposited(VAULT_MORPHO, deposit.assets, deposit.minShares, 2)), vault, owner, deposit)).toThrow(mismatch);
    // The same event emitted by another contract is not the vault's evidence.
    expect(() => verifyVaultReceipt(receipt(deposited(VAULT_MORPHO, deposit.assets, deposit.minShares, 1, otherVault)), vault, owner, deposit)).toThrow(mismatch);
  });

  it("ignores unrelated vault events and undecodable logs", () => {
    const junk = log(vault, [keccak256(stringToHex("Unknown()"))], "0x", 0);
    const result = verifyVaultReceipt(receipt(junk, transferred(owner, 1n, 3), deposited(VAULT_MORPHO, deposit.assets, deposit.minShares)), vault, owner, deposit);
    expect(result.assetsMinor).toBe(deposit.assets);
  });

  it("checks a strategy withdrawal's amount, strategy and share bound", () => {
    expect(verifyVaultReceipt(receipt(withdrawn(VAULT_MORPHO, withdraw.assets, withdraw.maxShares)), vault, owner, withdraw)).toEqual({ assetsMinor: withdraw.assets, shares: withdraw.maxShares });
    expect(() => verifyVaultReceipt(receipt(withdrawn(VAULT_MORPHO, withdraw.assets, withdraw.maxShares + 1n)), vault, owner, withdraw)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(withdrawn(VAULT_MORPHO, withdraw.assets + 1n, withdraw.maxShares)), vault, owner, withdraw)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(withdrawn(VAULT_USYC_POOL, withdraw.assets, withdraw.maxShares)), vault, owner, withdraw)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(withdrawn(VAULT_MORPHO, withdraw.assets, 1n, 1), withdrawn(VAULT_MORPHO, withdraw.assets, 1n, 2)), vault, owner, withdraw)).toThrow(mismatch);
  });

  it("checks a redemption to the owner: owner, exact shares and minimum assets", () => {
    expect(verifyVaultReceipt(receipt(redeemed(VAULT_MORPHO, owner, redeem.shares, redeem.minAssets + 10n)), vault, owner.toLowerCase(), redeem)).toEqual({ assetsMinor: redeem.minAssets + 10n, shares: redeem.shares });
    expect(() => verifyVaultReceipt(receipt(redeemed(VAULT_MORPHO, stranger, redeem.shares, redeem.minAssets)), vault, owner, redeem)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(redeemed(VAULT_MORPHO, owner, redeem.shares - 1n, redeem.minAssets)), vault, owner, redeem)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(redeemed(VAULT_MORPHO, owner, redeem.shares, redeem.minAssets - 1n)), vault, owner, redeem)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(redeemed(VAULT_USYC_POOL, owner, redeem.shares, redeem.minAssets)), vault, owner, redeem)).toThrow(mismatch);
  });

  it("checks a transfer to the owner: owner and exact amount", () => {
    expect(verifyVaultReceipt(receipt(transferred(owner, toOwner.amount)), vault, owner, toOwner)).toEqual({ assetsMinor: toOwner.amount, shares: 0n });
    expect(() => verifyVaultReceipt(receipt(transferred(stranger, toOwner.amount)), vault, owner, toOwner)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(transferred(owner, toOwner.amount - 1n)), vault, owner, toOwner)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(transferred(owner, toOwner.amount, 1), transferred(owner, toOwner.amount, 2)), vault, owner, toOwner)).toThrow(mismatch);
  });

  it("accepts a payment only with its canonical USDC transfer and returns that transfer's log index", () => {
    const result = verifyVaultReceipt(receipt(usdcTransfer(vault, recipient, pay.amount, 7), payment(recipient, pay.amount, pay.ref, 8)), vault, owner, pay);
    expect(result).toEqual({ assetsMinor: pay.amount, shares: 0n, logIndex: 7 });
    // Another transfer of the vault (to someone else) does not count.
    expect(verifyVaultReceipt(receipt(usdcTransfer(vault, stranger, pay.amount, 3), usdcTransfer(vault, recipient, pay.amount, 4), payment(recipient, pay.amount, pay.ref, 5)), vault, owner, pay).logIndex).toBe(4);
  });

  it("rejects a payment event without the matching USDC transfer", () => {
    expect(() => verifyVaultReceipt(receipt(payment(recipient, pay.amount, pay.ref)), vault, owner, pay)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(usdcTransfer(vault, recipient, pay.amount, 1, stranger), payment(recipient, pay.amount, pay.ref)), vault, owner, pay)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(usdcTransfer(stranger, recipient, pay.amount), payment(recipient, pay.amount, pay.ref)), vault, owner, pay)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(usdcTransfer(vault, stranger, pay.amount), payment(recipient, pay.amount, pay.ref)), vault, owner, pay)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(usdcTransfer(vault, recipient, pay.amount - 1n), payment(recipient, pay.amount, pay.ref)), vault, owner, pay)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(usdcTransfer(vault, recipient, pay.amount, 1), usdcTransfer(vault, recipient, pay.amount, 2), payment(recipient, pay.amount, pay.ref, 3)), vault, owner, pay)).toThrow(mismatch);
  });

  it("rejects a payment to another recipient, of another amount, for another bill, or emitted twice", () => {
    const transfer = usdcTransfer(vault, recipient, pay.amount);
    expect(() => verifyVaultReceipt(receipt(transfer, payment(stranger, pay.amount, pay.ref)), vault, owner, pay)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(transfer, payment(recipient, pay.amount + 1n, pay.ref)), vault, owner, pay)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(transfer, payment(recipient, pay.amount, billRef("another-bill"))), vault, owner, pay)).toThrow(mismatch);
    expect(() => verifyVaultReceipt(receipt(transfer, payment(recipient, pay.amount, pay.ref, 2), payment(recipient, pay.amount, pay.ref, 3)), vault, owner, pay)).toThrow(mismatch);
    expect(() => verifyVaultReceipt({ status: "reverted", logs: [transfer, payment(recipient, pay.amount, pay.ref)] }, vault, owner, pay)).toThrow("AGENT_VAULT_REVERTED");
  });
});
