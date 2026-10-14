// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import type { Obligation } from "@/lib/treasury/models";
import { sampleWorkspace } from "@/test/fixtures";

const m = vi.hoisted(() => ({ previewDeposit: vi.fn(), previewWithdraw: vi.fn(), previewRedeem: vi.fn(), convertToAssets: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./vault-state", () => ({
  previewDeposit: m.previewDeposit, previewWithdraw: m.previewWithdraw, previewRedeem: m.previewRedeem, convertToAssets: m.convertToAssets,
  readRecipients: vi.fn(), readVaultFunds: vi.fn(), verifiedVault: vi.fn(), usycApyBps: vi.fn(async () => null),
}));
vi.mock("./inputs", () => ({ agentInputs: vi.fn() }));
vi.mock("./store", () => ({ agentDb: vi.fn(), patchRun: vi.fn(), patchStep: vi.fn() }));
vi.mock("./circle", () => ({ agentAdapter: vi.fn() }));
vi.mock("./advisor-model", () => ({ advisorConfigured: vi.fn(async () => false), groqAdvisor: vi.fn(), groqVaultAdvisor: vi.fn() }));
vi.mock("@/lib/earn/gateway", () => ({ arcClient: {} }));
vi.mock("@/lib/earn/live-controls", () => ({ liveControls: vi.fn(async () => null) }));

import { nextVaultLeg, plannedLegs, vaultLegAllowed, type VaultInputs } from "./vault-runner";
import { billRef, maxSharesFor, minAssetsFor, minSharesFor, VAULT_LIMITS, VAULT_MORPHO, VAULT_STRATEGIES, VAULT_USYC_POOL, type VaultInstruction } from "./vault";
import type { VaultBill } from "./vault-decision";
import type { VaultUsyc } from "./vault-state";
import type { AgentRun } from "./store";
import type { Decision, Route } from "./models";

const USDC = 1_000_000n;
const NOW = new Date("2026-10-14T12:00:00.000Z");
const recipient = "0x4444444444444444444444444444444444444444";
const usdc = (minor: bigint) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits: minor.toString() });
// Twelve hours away: inside the one-day pay window and the three-day protection window (the vault keeps cash for it).
const dueAt = "2026-10-15T00:00:00.000Z";

const decision = (patch: Partial<Decision>): Decision => ({ kind: "NO_ACTION", depositMinor: "0", withdrawMinor: "0", transferMinor: "0", remainingBudgetMinor: "50000000", protectedMinor: "0", explanation: "test", ...patch });
const route = (patch: Partial<Record<keyof Route, bigint>>): Route => ({ depositMorphoMinor: String(patch.depositMorphoMinor ?? 0n), depositUsycMinor: String(patch.depositUsycMinor ?? 0n), withdrawMorphoMinor: String(patch.withdrawMorphoMinor ?? 0n), withdrawUsycMinor: String(patch.withdrawUsycMinor ?? 0n) });
const run = (d: Decision, returnAll = false): AgentRun => ({ id: "run-1", user_id: "user-1", state: "RUNNING", snapshot: { mode: "VAULT", vault: "0x3333333333333333333333333333333333333333", mandateRevision: 1 }, decision: d, quote: null, return_all: returnAll, created_at: new Date().toISOString(), failure: null });
const rentBill = { obligationId: "rent", recipient, amountMinor: (10n * USDC).toString(), dueAt };
const payBill = (withdrawMinor = 6n * USDC, r?: Route) => decision({ kind: "PAY_BILL", withdrawMinor: withdrawMinor.toString(), transferMinor: (10n * USDC).toString(), bill: rentBill, ...(r ? { route: r } : {}) });
const obligation = (patch: Partial<Obligation> = {}): Obligation => ({ id: "rent", title: "Rent", category: "RENT", amount: usdc(10n * USDC), dueAt, recipient: "Landlord", priority: "HIGH", status: "UPCOMING", description: "", recipientAddress: recipient, ...patch });
/** The vault's place in the USYC pool: 8 shares worth 10 USDC (1.25 USDC a share), all of it redeemable now. */
const usycAt = (patch: Partial<VaultUsyc> = {}): VaultUsyc => ({ shares: 8n * USDC, valueMinor: 10n * USDC, redeemableMinor: 10n * USDC, redeemableShares: 8n * USDC, depositRoomMinor: 100n * USDC, ready: true, afterHoursPricing: false, observedAt: new Date().toISOString(), ...patch });

type Funds = { idle?: bigint; shares?: bigint; redeemable?: bigint; position?: bigint; paymentRoom?: bigint; depositRoom?: bigint; usyc?: VaultUsyc | null; morphoObservedAt?: string };
function vaultInputs({ idle = 10n * USDC, shares = 0n, redeemable = 0n, position = redeemable, paymentRoom = 1_000n * USDC, depositRoom = 1_000n * USDC, usyc = null, morphoObservedAt }: Funds = {}, bills: VaultBill[] = [{ obligation: obligation(), approved: true, capMinor: 10n * USDC, busy: false }], activePayments: { id: string; obligation_id: string }[] = [], returnRequested = false): VaultInputs {
  const observedAt = new Date().toISOString();
  return {
    workspace: structuredClone(sampleWorkspace), ownerPositions: [],
    stored: { revision: 1, spent_minor: "0", return_requested: returnRequested, mandate: { budgetMinor: "50000000", reserveMinor: "0", maxPerRunMinor: "20000000", maxMorphoBps: 4000, enabled: true, paused: false } },
    config: { owner: "0x1111111111111111111111111111111111111111", operator: "0x2222222222222222222222222222222222222222", paused: false, asset: "0x3600000000000000000000000000000000000000", limits: { ...VAULT_LIMITS }, strategies: [...VAULT_STRATEGIES] },
    cash: { balance: usdc(USDC), observedAt }, feeReserveMinor: "100000",
    custodial: { shares: 0n, positionMinor: 0n, cashMinor: 0n },
    apy: { morphoBps: 400, usycBps: 450 },
    funds: {
      idle: { balance: usdc(idle), observedAt }, shares, depositRoomMinor: depositRoom, paymentRoomMinor: paymentRoom, usyc,
      position: { walletAddress: "0x3333333333333333333333333333333333333333", vaultAddress: VAULT_MORPHO, vaultName: "Morpho", currentBalance: usdc(position), maxWithdrawable: usdc(redeemable), redeemable: usdc(redeemable), liquidityStatus: "READY", shares: shares.toString(), apyBps: 0, pnl: { status: "UNAVAILABLE", reason: "No history" }, observedAt: morphoObservedAt ?? observedAt },
    },
    bills, activePayments,
  } as unknown as VaultInputs;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  m.previewDeposit.mockResolvedValue(19_000_000n);
  m.previewWithdraw.mockResolvedValue(5_900_000n);
  m.previewRedeem.mockImplementation(async (shares: bigint) => shares * 5n / 4n);
  m.convertToAssets.mockResolvedValue(30_100_000n);
});
afterEach(() => { vi.useRealTimers(); });

describe("nextVaultLeg", () => {
  it("INVEST deposits the decided amount with a minimum share bound from the strategy preview, then stops", async () => {
    const r = run(decision({ kind: "INVEST", depositMinor: (20n * USDC).toString() }));
    const leg = await nextVaultLeg(r, [], vaultInputs({ idle: 50n * USDC }));
    expect(leg).toEqual({ fn: "depositToStrategy", strategy: VAULT_MORPHO, assets: 20n * USDC, minShares: minSharesFor(19_000_000n) });
    expect(leg).toMatchObject({ minShares: 18_905_000n });
    expect(m.previewDeposit).toHaveBeenCalledWith(20n * USDC, VAULT_MORPHO);
    expect(await nextVaultLeg(r, [leg!], vaultInputs())).toBeNull();
  });

  it("PAY_BILL withdraws the missing part from Morpho, then pays the approved recipient with the bill reference", async () => {
    const r = run(payBill());
    const v = vaultInputs({ idle: 4n * USDC, shares: 30n * USDC, redeemable: 30n * USDC });
    const withdraw = await nextVaultLeg(r, [], v);
    expect(withdraw).toEqual({ fn: "withdrawFromStrategy", strategy: VAULT_MORPHO, assets: 6n * USDC, maxShares: maxSharesFor(5_900_000n) });
    expect(m.previewWithdraw).toHaveBeenCalledWith(6n * USDC);
    const pay = await nextVaultLeg(r, [withdraw!], vaultInputs({ idle: 10n * USDC, shares: 24n * USDC, redeemable: 24n * USDC }));
    expect(pay).toEqual({ fn: "pay", recipient: getAddress(recipient), amount: 10n * USDC, ref: billRef("rent") });
    expect(await nextVaultLeg(r, [withdraw!, pay!], vaultInputs())).toBeNull();
  });

  it("never lets a withdrawal burn more shares than the vault holds", async () => {
    const leg = await nextVaultLeg(run(payBill()), [], vaultInputs({ idle: 4n * USDC, shares: 5_910_000n, redeemable: 6n * USDC }));
    expect(leg).toMatchObject({ fn: "withdrawFromStrategy", maxShares: 5_910_000n });
  });

  it("PAY_BILL covered by idle cash is a single payment leg", async () => {
    const r = run(payBill(0n));
    const pay = await nextVaultLeg(r, [], vaultInputs());
    expect(pay).toEqual({ fn: "pay", recipient: getAddress(recipient), amount: 10n * USDC, ref: billRef("rent") });
    expect(m.previewWithdraw).not.toHaveBeenCalled();
    expect(await nextVaultLeg(r, [pay!], vaultInputs())).toBeNull();
  });

  it("PAY_BILL without its bill is refused", async () => {
    await expect(nextVaultLeg(run(decision({ kind: "PAY_BILL", transferMinor: "10000000" })), [], vaultInputs())).rejects.toThrow("AGENT_BILL_MISSING");
  });

  it("RETURN_ALL redeems every share to the owner, then sends the idle cash, then stops", async () => {
    const r = run(decision({ kind: "RETURN_ALL", withdrawMinor: (30n * USDC).toString() }), true);
    const redeem = await nextVaultLeg(r, [], vaultInputs({ idle: 2n * USDC, shares: 30n * USDC, redeemable: 30n * USDC }));
    expect(redeem).toEqual({ fn: "redeemToOwner", strategy: VAULT_MORPHO, shares: 30n * USDC, minAssets: minAssetsFor(30_100_000n) });
    expect(m.convertToAssets).toHaveBeenCalledWith(30n * USDC);
    const transfer = await nextVaultLeg(r, [redeem!], vaultInputs({ idle: 2n * USDC }));
    expect(transfer).toEqual({ fn: "transferToOwner", amount: 2n * USDC });
    expect(await nextVaultLeg(r, [redeem!, transfer!], vaultInputs({ idle: 2n * USDC }))).toBeNull();
  });

  it("RETURN_ALL with no Morpho shares only sends the idle cash, and does nothing on an empty vault", async () => {
    const r = run(decision({ kind: "RETURN_ALL", transferMinor: (2n * USDC).toString() }), true);
    expect(await nextVaultLeg(r, [], vaultInputs({ idle: 2n * USDC }))).toEqual({ fn: "transferToOwner", amount: 2n * USDC });
    expect(await nextVaultLeg(r, [], vaultInputs({ idle: 0n }))).toBeNull();
    // After the redemption an empty vault has nothing left to send.
    const redeem: VaultInstruction = { fn: "redeemToOwner", strategy: VAULT_MORPHO, shares: 1n, minAssets: 1n };
    expect(await nextVaultLeg(r, [redeem], vaultInputs({ idle: 0n }))).toBeNull();
  });

  it("LIQUIDITY_TOP_UP sends idle cash straight to the owner in one leg", async () => {
    const r = run(decision({ kind: "LIQUIDITY_TOP_UP", transferMinor: (3n * USDC).toString() }));
    const leg = await nextVaultLeg(r, [], vaultInputs({ idle: 50n * USDC }));
    expect(leg).toEqual({ fn: "transferToOwner", amount: 3n * USDC });
    expect(await nextVaultLeg(r, [leg!], vaultInputs())).toBeNull();
  });

  it("LIQUIDITY_TOP_UP without idle cash redeems just enough shares straight to the owner", async () => {
    m.previewWithdraw.mockResolvedValue(3_990_000n);
    const r = run(decision({ kind: "LIQUIDITY_TOP_UP", withdrawMinor: (4n * USDC).toString() }));
    expect(await nextVaultLeg(r, [], vaultInputs({ idle: 0n, shares: 10n * USDC, redeemable: 10n * USDC }))).toEqual({ fn: "redeemToOwner", strategy: VAULT_MORPHO, shares: 3_990_000n, minAssets: 3_980_000n });
  });

  it("RESERVE_REFILL and DE_RISK withdraw into the vault once; NO_ACTION has no leg", async () => {
    for (const kind of ["RESERVE_REFILL", "DE_RISK"] as const) {
      const r = run(decision({ kind, withdrawMinor: (6n * USDC).toString() }));
      const leg = await nextVaultLeg(r, [], vaultInputs({ shares: 30n * USDC, redeemable: 30n * USDC }));
      expect(leg).toEqual({ fn: "withdrawFromStrategy", strategy: VAULT_MORPHO, assets: 6n * USDC, maxShares: maxSharesFor(5_900_000n) });
      expect(await nextVaultLeg(r, [leg!], vaultInputs())).toBeNull();
    }
    expect(await nextVaultLeg(run(decision({})), [], vaultInputs())).toBeNull();
  });
});

describe("plannedLegs", () => {
  it("treats a legacy decision without a route as Morpho only", () => {
    expect(plannedLegs(decision({ kind: "INVEST", depositMinor: "20000000" }))).toEqual([{ type: "deposit", strategy: "MORPHO", amount: 20n * USDC }]);
    expect(plannedLegs(payBill())).toEqual([{ type: "withdraw", strategy: "MORPHO", amount: 6n * USDC }, { type: "pay" }]);
  });

  it("splits an INVEST across both strategies, Morpho first, and skips empty parts", () => {
    expect(plannedLegs(decision({ kind: "INVEST", depositMinor: "30000000", route: route({ depositMorphoMinor: 20n * USDC, depositUsycMinor: 10n * USDC }) })))
      .toEqual([{ type: "deposit", strategy: "MORPHO", amount: 20n * USDC }, { type: "deposit", strategy: "USYC", amount: 10n * USDC }]);
    expect(plannedLegs(decision({ kind: "INVEST", depositMinor: "10000000", route: route({ depositUsycMinor: 10n * USDC }) })))
      .toEqual([{ type: "deposit", strategy: "USYC", amount: 10n * USDC }]);
  });

  it("REBALANCE withdraws first, then deposits; PAY_BILL takes Morpho then USYC, then pays", () => {
    expect(plannedLegs(decision({ kind: "REBALANCE", route: route({ withdrawUsycMinor: 5n * USDC, depositMorphoMinor: 5n * USDC }) })))
      .toEqual([{ type: "withdraw", strategy: "USYC", amount: 5n * USDC }, { type: "deposit", strategy: "MORPHO", amount: 5n * USDC }]);
    expect(plannedLegs(payBill(6n * USDC, route({ withdrawMorphoMinor: 4n * USDC, withdrawUsycMinor: 2n * USDC }))))
      .toEqual([{ type: "withdraw", strategy: "MORPHO", amount: 4n * USDC }, { type: "withdraw", strategy: "USYC", amount: 2n * USDC }, { type: "pay" }]);
  });

  it("LIQUIDITY_TOP_UP is one leg: idle cash if any, otherwise one redemption to the owner", () => {
    expect(plannedLegs(decision({ kind: "LIQUIDITY_TOP_UP", transferMinor: "3000000", route: route({}) }))).toEqual([{ type: "transfer", amount: 3n * USDC }]);
    expect(plannedLegs(decision({ kind: "LIQUIDITY_TOP_UP", withdrawMinor: "5000000", route: route({ withdrawUsycMinor: 5n * USDC }) }))).toEqual([{ type: "toOwner", strategy: "USYC", amount: 5n * USDC }]);
  });

  it("has no planned legs for NO_ACTION, RETURN_ALL or MOVE_TO_VAULT (those are built from the vault's state)", () => {
    for (const kind of ["NO_ACTION", "RETURN_ALL", "MOVE_TO_VAULT"] as const) expect(plannedLegs(decision({ kind, withdrawMinor: "1000000" }))).toEqual([]);
  });
});

describe("nextVaultLeg with both strategies", () => {
  it("INVEST deposits into Morpho, then USYC, each with its own preview, then stops", async () => {
    const r = run(decision({ kind: "INVEST", depositMinor: (30n * USDC).toString(), route: route({ depositMorphoMinor: 20n * USDC, depositUsycMinor: 10n * USDC }) }));
    const morpho = await nextVaultLeg(r, [], vaultInputs({ idle: 30n * USDC }));
    expect(morpho).toEqual({ fn: "depositToStrategy", strategy: VAULT_MORPHO, assets: 20n * USDC, minShares: minSharesFor(19_000_000n) });
    expect(m.previewDeposit).toHaveBeenLastCalledWith(20n * USDC, VAULT_MORPHO);
    m.previewDeposit.mockResolvedValue(8_000_000n);
    const usyc = await nextVaultLeg(r, [morpho!], vaultInputs({ idle: 10n * USDC }));
    expect(usyc).toEqual({ fn: "depositToStrategy", strategy: VAULT_USYC_POOL, assets: 10n * USDC, minShares: minSharesFor(8_000_000n) });
    expect(m.previewDeposit).toHaveBeenLastCalledWith(10n * USDC, VAULT_USYC_POOL);
    expect(await nextVaultLeg(r, [morpho!, usyc!], vaultInputs({ idle: 0n }))).toBeNull();
  });

  it("REBALANCE from USYC to Morpho redeems shares with a 0.5% buffer, then deposits no more than the vault holds", async () => {
    const r = run(decision({ kind: "REBALANCE", withdrawMinor: (5n * USDC).toString(), depositMinor: (5n * USDC).toString(), route: route({ withdrawUsycMinor: 5n * USDC, depositMorphoMinor: 5n * USDC }) }));
    const redeem = await nextVaultLeg(r, [], vaultInputs({ idle: 0n, usyc: usycAt() }));
    // 5 USDC at 1.25 USDC a share is 4 shares; plus 0.5% is 4.02.
    expect(redeem).toEqual({ fn: "redeemFromStrategy", strategy: VAULT_USYC_POOL, shares: 4_020_000n, minAssets: minAssetsFor(5_025_000n) });
    expect(m.previewRedeem).toHaveBeenCalledWith(4_020_000n);
    // The redemption paid out a little less than planned: the deposit takes only what the vault holds.
    const deposit = await nextVaultLeg(r, [redeem!], vaultInputs({ idle: 4_990_000n, usyc: usycAt({ shares: 3_980_000n, redeemableShares: 3_980_000n }) }));
    expect(deposit).toEqual({ fn: "depositToStrategy", strategy: VAULT_MORPHO, assets: 4_990_000n, minShares: minSharesFor(19_000_000n) });
    expect(m.previewDeposit).toHaveBeenCalledWith(4_990_000n, VAULT_MORPHO);
    // With more cash than planned it deposits exactly the planned amount.
    expect(await nextVaultLeg(r, [redeem!], vaultInputs({ idle: 50n * USDC }))).toMatchObject({ fn: "depositToStrategy", assets: 5n * USDC });
    expect(await nextVaultLeg(r, [redeem!, deposit!], vaultInputs({ idle: 0n }))).toBeNull();
  });

  it("caps a USYC redemption at the shares the pool pays out now", async () => {
    const r = run(decision({ kind: "REBALANCE", route: route({ withdrawUsycMinor: 5n * USDC, depositMorphoMinor: 5n * USDC }) }));
    expect(await nextVaultLeg(r, [], vaultInputs({ usyc: usycAt({ redeemableShares: 4_010_000n }) }))).toMatchObject({ fn: "redeemFromStrategy", shares: 4_010_000n });
    expect(await nextVaultLeg(r, [], vaultInputs({ usyc: usycAt({ shares: 4_005_000n, valueMinor: 5_006_250n, redeemableShares: 8n * USDC }) }))).toMatchObject({ fn: "redeemFromStrategy", shares: 4_005_000n });
  });

  it("refuses a USYC leg when the vault's USYC position cannot be valued", async () => {
    const r = run(decision({ kind: "REBALANCE", route: route({ withdrawUsycMinor: 5n * USDC, depositMorphoMinor: 5n * USDC }) }));
    await expect(nextVaultLeg(r, [], vaultInputs({ usyc: null }))).rejects.toThrow("AGENT_USYC_UNAVAILABLE");
    await expect(nextVaultLeg(r, [], vaultInputs({ usyc: usycAt({ valueMinor: 0n }) }))).rejects.toThrow("AGENT_USYC_UNAVAILABLE");
    await expect(nextVaultLeg(r, [], vaultInputs({ usyc: usycAt({ shares: 0n }) }))).rejects.toThrow("AGENT_USYC_UNAVAILABLE");
  });

  it("PAY_BILL takes the missing part from Morpho, then USYC, then pays", async () => {
    const r = run(payBill(6n * USDC, route({ withdrawMorphoMinor: 4n * USDC, withdrawUsycMinor: 2n * USDC })));
    m.previewWithdraw.mockResolvedValue(3_950_000n);
    const morpho = await nextVaultLeg(r, [], vaultInputs({ idle: 4n * USDC, shares: 4n * USDC, redeemable: 4n * USDC, usyc: usycAt() }));
    expect(morpho).toEqual({ fn: "withdrawFromStrategy", strategy: VAULT_MORPHO, assets: 4n * USDC, maxShares: maxSharesFor(3_950_000n) });
    const usyc = await nextVaultLeg(r, [morpho!], vaultInputs({ idle: 8n * USDC, usyc: usycAt() }));
    // 2 USDC is 1.6 shares; plus 0.5% is 1.608.
    expect(usyc).toEqual({ fn: "redeemFromStrategy", strategy: VAULT_USYC_POOL, shares: 1_608_000n, minAssets: minAssetsFor(2_010_000n) });
    const pay = await nextVaultLeg(r, [morpho!, usyc!], vaultInputs({ idle: 10_010_000n }));
    expect(pay).toEqual({ fn: "pay", recipient: getAddress(recipient), amount: 10n * USDC, ref: billRef("rent") });
    expect(await nextVaultLeg(r, [morpho!, usyc!, pay!], vaultInputs({ idle: 10_000n }))).toBeNull();
  });

  it("LIQUIDITY_TOP_UP from USYC redeems the exact shares straight to the owner, without a buffer", async () => {
    const r = run(decision({ kind: "LIQUIDITY_TOP_UP", withdrawMinor: (5n * USDC).toString(), route: route({ withdrawUsycMinor: 5n * USDC }) }));
    const leg = await nextVaultLeg(r, [], vaultInputs({ idle: 0n, usyc: usycAt() }));
    expect(leg).toEqual({ fn: "redeemToOwner", strategy: VAULT_USYC_POOL, shares: 4n * USDC, minAssets: minAssetsFor(5n * USDC) });
    expect(m.previewRedeem).toHaveBeenCalledWith(4n * USDC);
    expect(await nextVaultLeg(r, [leg!], vaultInputs({ idle: 0n }))).toBeNull();
  });

  it("RETURN_ALL redeems Morpho, then the redeemable USYC shares, to the owner, then sends the cash, then stops", async () => {
    const r = run(decision({ kind: "RETURN_ALL", withdrawMinor: (40n * USDC).toString(), transferMinor: (2n * USDC).toString(), route: route({ withdrawMorphoMinor: 30n * USDC, withdrawUsycMinor: 10n * USDC }) }), true);
    const morpho = await nextVaultLeg(r, [], vaultInputs({ idle: 2n * USDC, shares: 30n * USDC, redeemable: 30n * USDC, usyc: usycAt({ redeemableShares: 7n * USDC }) }));
    expect(morpho).toEqual({ fn: "redeemToOwner", strategy: VAULT_MORPHO, shares: 30n * USDC, minAssets: minAssetsFor(30_100_000n) });
    const usyc = await nextVaultLeg(r, [morpho!], vaultInputs({ idle: 2n * USDC, usyc: usycAt({ redeemableShares: 7n * USDC }) }));
    expect(usyc).toEqual({ fn: "redeemToOwner", strategy: VAULT_USYC_POOL, shares: 7n * USDC, minAssets: minAssetsFor(8_750_000n) });
    expect(m.previewRedeem).toHaveBeenCalledWith(7n * USDC);
    const transfer = await nextVaultLeg(r, [morpho!, usyc!], vaultInputs({ idle: 2n * USDC, usyc: usycAt({ shares: USDC, redeemableShares: USDC }) }));
    expect(transfer).toEqual({ fn: "transferToOwner", amount: 2n * USDC });
    expect(await nextVaultLeg(r, [morpho!, usyc!, transfer!], vaultInputs({ idle: 2n * USDC }))).toBeNull();
  });

  it("RETURN_ALL with only USYC redeems it first, and skips USYC the pool will not pay out now", async () => {
    const r = run(decision({ kind: "RETURN_ALL" }), true);
    expect(await nextVaultLeg(r, [], vaultInputs({ idle: 2n * USDC, usyc: usycAt() }))).toMatchObject({ fn: "redeemToOwner", strategy: VAULT_USYC_POOL, shares: 8n * USDC });
    expect(await nextVaultLeg(r, [], vaultInputs({ idle: 2n * USDC, usyc: usycAt({ ready: false, redeemableShares: 0n }) }))).toEqual({ fn: "transferToOwner", amount: 2n * USDC });
  });
});

describe("vaultLegAllowed for a bill payment", () => {
  const pay: VaultInstruction = { fn: "pay", recipient: getAddress(recipient), amount: 10n * USDC, ref: billRef("rent") };
  const withdraw: VaultInstruction = { fn: "withdrawFromStrategy", strategy: VAULT_MORPHO, assets: 6n * USDC, maxShares: 6_030_000n };
  const fresh = decision({});
  const approved = (patch: Partial<VaultBill> = {}, o: Partial<Obligation> = {}): VaultBill[] => [{ obligation: obligation(o), approved: true, capMinor: 10n * USDC, busy: false, ...patch }];

  it("allows the payment while the bill, its approval and the vault's funds still hold", () => {
    expect(vaultLegAllowed(run(payBill()), pay, fresh, vaultInputs())).toBe(true);
    // The recipient may come back in another letter case.
    expect(vaultLegAllowed(run(payBill()), pay, fresh, vaultInputs({}, approved({}, { recipientAddress: getAddress(recipient) })))).toBe(true);
  });

  it("allows only the payment of exactly this bill: its recipient, amount and reference", () => {
    for (const other of [{ ...pay, recipient: getAddress("0x5555555555555555555555555555555555555555") }, { ...pay, amount: 9n * USDC }, { ...pay, ref: billRef("another-bill") }] as VaultInstruction[]) {
      expect(vaultLegAllowed(run(payBill()), other, fresh, vaultInputs())).toBe(false);
    }
  });

  it("never lets a bill run redeem straight to the owner, or redeem zero shares", () => {
    const toOwner: VaultInstruction = { fn: "redeemToOwner", strategy: VAULT_MORPHO, shares: 6n * USDC, minAssets: 1n };
    expect(vaultLegAllowed(run(payBill()), toOwner, fresh, vaultInputs({ idle: 4n * USDC, shares: 30n * USDC, redeemable: 30n * USDC }))).toBe(false);
    const nothing: VaultInstruction = { fn: "redeemFromStrategy", strategy: VAULT_MORPHO, shares: 0n, minAssets: 1n };
    expect(vaultLegAllowed(run(payBill()), nothing, fresh, vaultInputs({ idle: 4n * USDC, shares: 30n * USDC, redeemable: 30n * USDC }))).toBe(false);
  });

  it("refuses when the bill's amount changed", () => {
    expect(vaultLegAllowed(run(payBill()), pay, fresh, vaultInputs({}, approved({ capMinor: 20n * USDC }, { amount: usdc(11n * USDC) })))).toBe(false);
    expect(vaultLegAllowed(run(payBill()), pay, fresh, vaultInputs({}, approved({}, { amount: usdc(9n * USDC) })))).toBe(false);
  });

  it("refuses when the bill's recipient changed or was removed", () => {
    expect(vaultLegAllowed(run(payBill()), pay, fresh, vaultInputs({}, approved({}, { recipientAddress: "0x5555555555555555555555555555555555555555" })))).toBe(false);
    expect(vaultLegAllowed(run(payBill()), pay, fresh, vaultInputs({}, approved({}, { recipientAddress: null })))).toBe(false);
  });

  it("refuses when the bill is no longer open", () => {
    expect(vaultLegAllowed(run(payBill()), pay, fresh, vaultInputs({}, []))).toBe(false);
    expect(vaultLegAllowed(run(payBill()), pay, fresh, vaultInputs({}, approved({}, { id: "other-bill" })))).toBe(false);
  });

  it("refuses when the recipient is not approved or its cap is below the bill", () => {
    expect(vaultLegAllowed(run(payBill()), pay, fresh, vaultInputs({}, approved({ approved: false })))).toBe(false);
    expect(vaultLegAllowed(run(payBill()), pay, fresh, vaultInputs({}, approved({ capMinor: 10n * USDC - 1n })))).toBe(false);
  });

  it("refuses while someone else's payment of the same bill is open, but not for this step's own record", () => {
    const r = run(payBill());
    expect(vaultLegAllowed(r, pay, fresh, vaultInputs({}, approved(), [{ id: "owner-payment", obligation_id: "rent" }]), "step-1")).toBe(false);
    expect(vaultLegAllowed(r, pay, fresh, vaultInputs({}, approved(), [{ id: "owner-payment", obligation_id: "rent" }]))).toBe(false);
    expect(vaultLegAllowed(r, pay, fresh, vaultInputs({}, approved(), [{ id: "step-1", obligation_id: "rent" }]), "step-1")).toBe(true);
    expect(vaultLegAllowed(r, pay, fresh, vaultInputs({}, approved(), [{ id: "step-1", obligation_id: "rent" }]))).toBe(false);
    expect(vaultLegAllowed(r, pay, fresh, vaultInputs({}, approved(), [{ id: "step-1", obligation_id: "rent" }, { id: "step-2", obligation_id: "rent" }]), "step-1")).toBe(false);
  });

  it("refuses while any other payment of the user is open, even for an unrelated bill (the ledger can only settle one)", () => {
    const r = run(payBill());
    expect(vaultLegAllowed(r, pay, fresh, vaultInputs({}, approved(), [{ id: "other", obligation_id: "water" }]))).toBe(false);
    expect(vaultLegAllowed(r, pay, fresh, vaultInputs({}, approved(), [{ id: "other", obligation_id: "water" }]), "step-1")).toBe(false);
    expect(vaultLegAllowed(r, withdraw, fresh, vaultInputs({ idle: 4n * USDC, redeemable: 6n * USDC }, approved(), [{ id: "other", obligation_id: "water" }]))).toBe(false);
    expect(vaultLegAllowed(r, pay, fresh, vaultInputs({}, approved(), [{ id: "step-1", obligation_id: "rent" }, { id: "other", obligation_id: "water" }]), "step-1")).toBe(false);
    // Only this step's own record open: allowed. Nothing open at all: allowed.
    expect(vaultLegAllowed(r, pay, fresh, vaultInputs({}, approved(), [{ id: "step-1", obligation_id: "rent" }]), "step-1")).toBe(true);
    expect(vaultLegAllowed(r, pay, fresh, vaultInputs({}, approved(), []))).toBe(true);
  });

  it("refuses the payment leg without the idle cash or the 24-hour payment room", () => {
    expect(vaultLegAllowed(run(payBill()), pay, fresh, vaultInputs({ idle: 10n * USDC - 1n, redeemable: 100n * USDC }))).toBe(false);
    expect(vaultLegAllowed(run(payBill()), pay, fresh, vaultInputs({ paymentRoom: 10n * USDC - 1n }))).toBe(false);
    expect(vaultLegAllowed(run(payBill()), pay, fresh, vaultInputs({ paymentRoom: 10n * USDC }))).toBe(true);
  });

  it("allows the withdrawal leg only while idle cash plus redeemable Morpho covers the bill", () => {
    expect(vaultLegAllowed(run(payBill()), withdraw, fresh, vaultInputs({ idle: 4n * USDC, redeemable: 6n * USDC }))).toBe(true);
    expect(vaultLegAllowed(run(payBill()), withdraw, fresh, vaultInputs({ idle: 4n * USDC, redeemable: 6n * USDC - 1n }))).toBe(false);
    expect(vaultLegAllowed(run(payBill()), withdraw, fresh, vaultInputs({ idle: 4n * USDC, redeemable: 6n * USDC }, approved({ approved: false })))).toBe(false);
    // A stale Morpho read counts as nothing redeemable.
    expect(vaultLegAllowed(run(payBill()), withdraw, fresh, vaultInputs({ idle: 4n * USDC, redeemable: 6n * USDC, morphoObservedAt: new Date(NOW.getTime() - 120_000).toISOString() }))).toBe(false);
  });

  it("allows a USYC withdrawal leg only while USYC is fresh, ready and pays out those shares, and the bill is covered", () => {
    const r = run(payBill(6n * USDC, route({ withdrawUsycMinor: 6n * USDC })));
    const redeem: VaultInstruction = { fn: "redeemFromStrategy", strategy: VAULT_USYC_POOL, shares: 4_824_000n, minAssets: 6_000_000n };
    expect(vaultLegAllowed(r, redeem, fresh, vaultInputs({ idle: 4n * USDC, usyc: usycAt() }))).toBe(true);
    // Morpho and USYC together may cover it.
    expect(vaultLegAllowed(r, redeem, fresh, vaultInputs({ idle: 2n * USDC, redeemable: 2n * USDC, usyc: usycAt({ redeemableMinor: 6n * USDC }) }))).toBe(true);
    expect(vaultLegAllowed(r, redeem, fresh, vaultInputs({ idle: 2n * USDC, redeemable: 2n * USDC - 1n, usyc: usycAt({ redeemableMinor: 6n * USDC }) }))).toBe(false);
    expect(vaultLegAllowed(r, redeem, fresh, vaultInputs({ idle: 4n * USDC, usyc: usycAt({ ready: false }) }))).toBe(false);
    expect(vaultLegAllowed(r, redeem, fresh, vaultInputs({ idle: 4n * USDC, usyc: usycAt({ observedAt: new Date(NOW.getTime() - 120_000).toISOString() }) }))).toBe(false);
    expect(vaultLegAllowed(r, redeem, fresh, vaultInputs({ idle: 4n * USDC, usyc: usycAt({ redeemableShares: 4_823_999n }) }))).toBe(false);
    expect(vaultLegAllowed(r, redeem, fresh, vaultInputs({ idle: 4n * USDC, usyc: null }))).toBe(false);
  });

  it("never allows a deposit leg in a bill payment run", () => {
    const deposit: VaultInstruction = { fn: "depositToStrategy", strategy: VAULT_MORPHO, assets: USDC, minShares: 1n };
    expect(vaultLegAllowed(run(payBill()), deposit, fresh, vaultInputs({ idle: 100n * USDC, redeemable: 100n * USDC }))).toBe(false);
  });
});

describe("vaultLegAllowed for other runs", () => {
  const toOwner: VaultInstruction = { fn: "transferToOwner", amount: 2n * USDC };
  const morphoDeposit = (assets: bigint): VaultInstruction => ({ fn: "depositToStrategy", strategy: VAULT_MORPHO, assets, minShares: 1n });
  const usycDeposit = (assets: bigint): VaultInstruction => ({ fn: "depositToStrategy", strategy: VAULT_USYC_POOL, assets, minShares: 1n });
  const invest = run(decision({ kind: "INVEST", depositMinor: (20n * USDC).toString() }));
  // Things that come before investing in fresh state.
  const first = [
    decision({ kind: "PAY_BILL", transferMinor: (10n * USDC).toString(), bill: rentBill }),
    decision({ kind: "LIQUIDITY_TOP_UP", transferMinor: "1" }),
    decision({ kind: "MOVE_TO_VAULT", withdrawMinor: "1" }),
    decision({ kind: "RETURN_ALL" }),
  ];

  it("lets a deposit spend the vault's whole cash, even what the engine would keep for a bill, but never more", () => {
    // 50 idle, 10 the engine would keep for the rent: the advisor may still invest all 50 (the bill is paid on its payment day).
    expect(vaultLegAllowed(invest, morphoDeposit(50n * USDC), decision({}), vaultInputs({ idle: 50n * USDC }))).toBe(true);
    expect(vaultLegAllowed(invest, morphoDeposit(50n * USDC + 1n), decision({}), vaultInputs({ idle: 50n * USDC }))).toBe(false);
    expect(vaultLegAllowed(invest, morphoDeposit(20n * USDC), decision({}), vaultInputs({ idle: 10n * USDC }))).toBe(false);
    // But not while the bill is due: the payment comes first.
    expect(vaultLegAllowed(invest, morphoDeposit(5n * USDC), decision({ kind: "PAY_BILL" }), vaultInputs({ idle: 50n * USDC }))).toBe(false);
    // A deposit of nothing (the vault's cash already gone) is never signed.
    expect(vaultLegAllowed(invest, morphoDeposit(0n), decision({}), vaultInputs({ idle: 0n }, []))).toBe(false);
  });

  it("lets a deposit go only up to what the destination can take now", () => {
    // Morpho: the vault's own deposit room, and only on a fresh read.
    expect(vaultLegAllowed(invest, morphoDeposit(20n * USDC), decision({}), vaultInputs({ idle: 50n * USDC, depositRoom: 20n * USDC }))).toBe(true);
    expect(vaultLegAllowed(invest, morphoDeposit(20n * USDC), decision({}), vaultInputs({ idle: 50n * USDC, depositRoom: 20n * USDC - 1n }))).toBe(false);
    expect(vaultLegAllowed(invest, morphoDeposit(20n * USDC), decision({}), vaultInputs({ idle: 50n * USDC, morphoObservedAt: new Date(NOW.getTime() - 120_000).toISOString() }))).toBe(false);
    // USYC: what the pool accepts, only while it is ready and fresh.
    expect(vaultLegAllowed(invest, usycDeposit(5n * USDC), decision({}), vaultInputs({ idle: 50n * USDC, usyc: usycAt({ depositRoomMinor: 5n * USDC }) }))).toBe(true);
    expect(vaultLegAllowed(invest, usycDeposit(5n * USDC + 1n), decision({}), vaultInputs({ idle: 50n * USDC, usyc: usycAt({ depositRoomMinor: 5n * USDC }) }))).toBe(false);
    expect(vaultLegAllowed(invest, usycDeposit(5n * USDC), decision({}), vaultInputs({ idle: 50n * USDC, usyc: usycAt({ ready: false }) }))).toBe(false);
    expect(vaultLegAllowed(invest, usycDeposit(5n * USDC), decision({}), vaultInputs({ idle: 50n * USDC, usyc: usycAt({ observedAt: new Date(NOW.getTime() - 120_000).toISOString() }) }))).toBe(false);
    expect(vaultLegAllowed(invest, usycDeposit(5n * USDC), decision({}), vaultInputs({ idle: 50n * USDC, usyc: null }))).toBe(false);
    // ...and never beyond the vault's own deposit room either.
    expect(vaultLegAllowed(invest, usycDeposit(5n * USDC), decision({}), vaultInputs({ idle: 50n * USDC, depositRoom: 4n * USDC, usyc: usycAt() }))).toBe(false);
  });

  it("never moves money into or between strategies while a bill, a top-up, a move or a return comes first", () => {
    const usycRedeem: VaultInstruction = { fn: "redeemFromStrategy", strategy: VAULT_USYC_POOL, shares: USDC, minAssets: 1n };
    const v = vaultInputs({ idle: 50n * USDC, redeemable: 50n * USDC, usyc: usycAt() });
    for (const kind of ["INVEST", "REBALANCE", "DE_RISK", "RESERVE_REFILL"] as const) {
      const r = run(decision({ kind }));
      for (const op of [morphoDeposit(USDC), usycRedeem]) {
        for (const ahead of first) expect(vaultLegAllowed(r, op, ahead, v)).toBe(false);
        for (const ok of [decision({}), decision({ kind: "INVEST" }), decision({ kind: "REBALANCE" })]) expect(vaultLegAllowed(r, op, ok, v)).toBe(true);
      }
    }
  });

  it("lets a rebalance redeem USYC only while USYC is ready, fresh and pays out those shares", () => {
    const r = run(decision({ kind: "REBALANCE", route: route({ withdrawUsycMinor: 5n * USDC, depositMorphoMinor: 5n * USDC }) }));
    const redeem: VaultInstruction = { fn: "redeemFromStrategy", strategy: VAULT_USYC_POOL, shares: 4_020_000n, minAssets: 1n };
    expect(vaultLegAllowed(r, redeem, decision({}), vaultInputs({ usyc: usycAt() }))).toBe(true);
    expect(vaultLegAllowed(r, redeem, decision({}), vaultInputs({ usyc: usycAt({ redeemableShares: 4_020_000n }) }))).toBe(true);
    expect(vaultLegAllowed(r, redeem, decision({}), vaultInputs({ usyc: usycAt({ redeemableShares: 4_019_999n }) }))).toBe(false);
    expect(vaultLegAllowed(r, redeem, decision({}), vaultInputs({ usyc: usycAt({ ready: false }) }))).toBe(false);
    expect(vaultLegAllowed(r, redeem, decision({}), vaultInputs({ usyc: usycAt({ observedAt: new Date(NOW.getTime() - 120_000).toISOString() }) }))).toBe(false);
    expect(vaultLegAllowed(r, redeem, decision({}), vaultInputs({ usyc: null }))).toBe(false);
    // Sending cash to the owner is never a rebalance leg.
    expect(vaultLegAllowed(r, toOwner, decision({}), vaultInputs({ idle: 50n * USDC }))).toBe(false);
  });

  it("lets a de-risk withdrawal proceed while the engine would only invest or wait and Morpho can cover it", () => {
    const r = run(decision({ kind: "DE_RISK", withdrawMinor: (6n * USDC).toString() }));
    const withdraw: VaultInstruction = { fn: "withdrawFromStrategy", strategy: VAULT_MORPHO, assets: 6n * USDC, maxShares: 6_030_000n };
    expect(vaultLegAllowed(r, withdraw, decision({ kind: "NO_ACTION" }), vaultInputs({ redeemable: 6n * USDC }))).toBe(true);
    expect(vaultLegAllowed(r, withdraw, decision({ kind: "INVEST" }), vaultInputs({ redeemable: 6n * USDC }))).toBe(true);
    expect(vaultLegAllowed(r, withdraw, decision({ kind: "LIQUIDITY_TOP_UP", transferMinor: "1" }), vaultInputs({ redeemable: 6n * USDC }))).toBe(false);
    expect(vaultLegAllowed(r, withdraw, decision({ kind: "INVEST" }), vaultInputs({ redeemable: 6n * USDC - 1n }))).toBe(false);
    expect(vaultLegAllowed(r, withdraw, decision({ kind: "INVEST" }), vaultInputs({ redeemable: 6n * USDC, morphoObservedAt: new Date(NOW.getTime() - 120_000).toISOString() }))).toBe(false);
  });

  it("lets a top-up redeem USYC to the owner while the fresh engine still asks for at least as much", () => {
    const r = run(decision({ kind: "LIQUIDITY_TOP_UP", withdrawMinor: (5n * USDC).toString(), route: route({ withdrawUsycMinor: 5n * USDC }) }));
    const redeem: VaultInstruction = { fn: "redeemToOwner", strategy: VAULT_USYC_POOL, shares: 4n * USDC, minAssets: 4_975_000n };
    const topUp = (withdraw: bigint) => decision({ kind: "LIQUIDITY_TOP_UP", withdrawMinor: withdraw.toString() });
    expect(vaultLegAllowed(r, redeem, topUp(5n * USDC), vaultInputs({ idle: 0n, usyc: usycAt() }))).toBe(true);
    expect(vaultLegAllowed(r, redeem, topUp(5n * USDC - 1n), vaultInputs({ idle: 0n, usyc: usycAt() }))).toBe(false);
    expect(vaultLegAllowed(r, redeem, decision({}), vaultInputs({ idle: 0n, usyc: usycAt() }))).toBe(false);
    expect(vaultLegAllowed(r, redeem, topUp(5n * USDC), vaultInputs({ idle: 0n, usyc: usycAt({ ready: false }) }))).toBe(false);
    expect(vaultLegAllowed(r, redeem, topUp(5n * USDC), vaultInputs({ idle: 0n, usyc: usycAt({ redeemableShares: 4n * USDC - 1n }) }))).toBe(false);
  });

  it("returns everything only while the owner still asks for it", () => {
    const r = run(decision({ kind: "RETURN_ALL" }), true);
    expect(vaultLegAllowed(r, toOwner, decision({}), vaultInputs({}, [], [], true))).toBe(true);
    expect(vaultLegAllowed(r, toOwner, decision({}), vaultInputs({}, [], [], false))).toBe(false);
    expect(vaultLegAllowed(run(decision({ kind: "RETURN_ALL" }), false), toOwner, decision({}), vaultInputs({}, [], [], true))).toBe(false);
  });

  it("never allows a leg for a NO_ACTION run", () => {
    expect(vaultLegAllowed(run(decision({})), toOwner, decision({}), vaultInputs())).toBe(false);
  });
});

describe("moving custodial funds into the vault", () => {
  const withCustodial = (shares: bigint, cash: bigint) => ({ ...vaultInputs(), custodial: { shares, positionMinor: shares / 1_000_000_000_000n, cashMinor: cash } }) as unknown as VaultInputs;
  it("moves the agent's Morpho shares first, then its cash above the fee float, then stops", async () => {
    const r = run(decision({ kind: "MOVE_TO_VAULT", withdrawMinor: (20n * USDC).toString(), transferMinor: (19n * USDC).toString() }));
    const v = withCustodial(19_942_138_980_429_123_206n, 20_025_098n);
    const shares = await nextVaultLeg(r, [], v);
    expect(shares).toEqual({ fn: "moveShares", amount: 19_942_138_980_429_123_206n });
    expect(vaultLegAllowed(r, shares!, decision({}), v)).toBe(true);
    const cash = await nextVaultLeg(r, [shares!], withCustodial(0n, 20_025_098n));
    expect(cash).toEqual({ fn: "moveCash", amount: 19_525_098n });
    expect(await nextVaultLeg(r, [shares!, cash!], withCustodial(0n, 500_000n))).toBeNull();
  });
  it("never moves more than the agent holds or eats into its fee float", () => {
    const r = run(decision({ kind: "MOVE_TO_VAULT" }));
    expect(vaultLegAllowed(r, { fn: "moveShares", amount: 2n }, decision({}), withCustodial(1n, 0n))).toBe(false);
    expect(vaultLegAllowed(r, { fn: "moveCash", amount: 600_000n }, decision({}), withCustodial(0n, 1_000_000n))).toBe(false);
    expect(vaultLegAllowed(r, { fn: "moveCash", amount: 500_000n }, decision({}), withCustodial(0n, 1_000_000n))).toBe(true);
  });
});
