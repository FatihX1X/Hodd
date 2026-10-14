// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAddress } from "viem";
import type { Obligation } from "@/lib/treasury/models";

const m = vi.hoisted(() => ({ previewDeposit: vi.fn(), previewWithdraw: vi.fn(), convertToAssets: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./vault-state", () => ({
  previewDeposit: m.previewDeposit, previewWithdraw: m.previewWithdraw, convertToAssets: m.convertToAssets,
  readRecipients: vi.fn(), readVaultFunds: vi.fn(), verifiedVault: vi.fn(),
}));
vi.mock("./inputs", () => ({ agentInputs: vi.fn() }));
vi.mock("./store", () => ({ agentDb: vi.fn(), patchRun: vi.fn(), patchStep: vi.fn() }));
vi.mock("./circle", () => ({ agentAdapter: vi.fn() }));
vi.mock("./advisor-model", () => ({ advisorConfigured: vi.fn(async () => false), groqAdvisor: vi.fn() }));
vi.mock("@/lib/earn/gateway", () => ({ arcClient: {} }));
vi.mock("@/lib/earn/live-controls", () => ({ liveControls: vi.fn(async () => null) }));

import { nextVaultLeg, vaultLegAllowed, type VaultInputs } from "./vault-runner";
import { billRef, maxSharesFor, minAssetsFor, minSharesFor, VAULT_MORPHO, type VaultInstruction } from "./vault";
import type { VaultBill } from "./vault-decision";
import type { AgentRun } from "./store";
import type { Decision } from "./models";

const USDC = 1_000_000n;
const recipient = "0x4444444444444444444444444444444444444444";
const usdc = (minor: bigint) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits: minor.toString() });
const dueAt = "2026-10-15T00:00:00.000Z";

const decision = (patch: Partial<Decision>): Decision => ({ kind: "NO_ACTION", depositMinor: "0", withdrawMinor: "0", transferMinor: "0", remainingBudgetMinor: "50000000", protectedMinor: "0", explanation: "test", ...patch });
const run = (d: Decision, returnAll = false): AgentRun => ({ id: "run-1", user_id: "user-1", state: "RUNNING", snapshot: { mode: "VAULT", vault: "0x3333333333333333333333333333333333333333", mandateRevision: 1 }, decision: d, quote: null, return_all: returnAll, created_at: new Date().toISOString(), failure: null });
const rentBill = { obligationId: "rent", recipient, amountMinor: (10n * USDC).toString(), dueAt };
const payBill = (withdrawMinor = 6n * USDC) => decision({ kind: "PAY_BILL", withdrawMinor: withdrawMinor.toString(), transferMinor: (10n * USDC).toString(), bill: rentBill });
const obligation = (patch: Partial<Obligation> = {}): Obligation => ({ id: "rent", title: "Rent", category: "RENT", amount: usdc(10n * USDC), dueAt, recipient: "Landlord", priority: "HIGH", status: "UPCOMING", description: "", recipientAddress: recipient, ...patch });

type Funds = { idle?: bigint; shares?: bigint; redeemable?: bigint; position?: bigint; paymentRoom?: bigint };
function vaultInputs({ idle = 10n * USDC, shares = 0n, redeemable = 0n, position = redeemable, paymentRoom = 1_000n * USDC }: Funds = {}, bills: VaultBill[] = [{ obligation: obligation(), approved: true, capMinor: 10n * USDC, busy: false }], activePayments: { id: string; obligation_id: string }[] = [], returnRequested = false): VaultInputs {
  return {
    stored: { revision: 1, spent_minor: "0", return_requested: returnRequested, mandate: { budgetMinor: "50000000", reserveMinor: "0", maxPerRunMinor: "20000000", maxMorphoBps: 4000, enabled: true, paused: false } },
    funds: {
      idle: { balance: usdc(idle), observedAt: new Date().toISOString() }, shares, depositRoomMinor: 1_000n * USDC, paymentRoomMinor: paymentRoom,
      position: { walletAddress: "0x3333333333333333333333333333333333333333", vaultAddress: VAULT_MORPHO, vaultName: "Morpho", currentBalance: usdc(position), maxWithdrawable: usdc(redeemable), redeemable: usdc(redeemable), liquidityStatus: "READY", shares: shares.toString(), apyBps: 0, pnl: { status: "UNAVAILABLE", reason: "No history" }, observedAt: new Date().toISOString() },
    },
    bills, activePayments,
  } as unknown as VaultInputs;
}

beforeEach(() => {
  vi.clearAllMocks();
  m.previewDeposit.mockResolvedValue(19_000_000n);
  m.previewWithdraw.mockResolvedValue(5_900_000n);
  m.convertToAssets.mockResolvedValue(30_100_000n);
});

describe("nextVaultLeg", () => {
  it("INVEST deposits the decided amount with a minimum share bound from the strategy preview, then stops", async () => {
    const r = run(decision({ kind: "INVEST", depositMinor: (20n * USDC).toString() }));
    const leg = await nextVaultLeg(r, [], vaultInputs({ idle: 50n * USDC }));
    expect(leg).toEqual({ fn: "depositToStrategy", strategy: VAULT_MORPHO, assets: 20n * USDC, minShares: minSharesFor(19_000_000n) });
    expect(leg).toMatchObject({ minShares: 18_905_000n });
    expect(m.previewDeposit).toHaveBeenCalledWith(20n * USDC);
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
  });
});

describe("vaultLegAllowed for other runs", () => {
  const deposit: VaultInstruction = { fn: "depositToStrategy", strategy: VAULT_MORPHO, assets: 20n * USDC, minShares: 1n };
  const toOwner: VaultInstruction = { fn: "transferToOwner", amount: 2n * USDC };

  it("lets an investment proceed only while the fresh engine would still invest at least as much", () => {
    const r = run(decision({ kind: "INVEST", depositMinor: (20n * USDC).toString() }));
    expect(vaultLegAllowed(r, deposit, decision({ kind: "INVEST", depositMinor: (20n * USDC).toString() }), vaultInputs())).toBe(true);
    expect(vaultLegAllowed(r, deposit, decision({ kind: "INVEST", depositMinor: (20n * USDC - 1n).toString() }), vaultInputs())).toBe(false);
    expect(vaultLegAllowed(r, deposit, decision({ kind: "PAY_BILL", transferMinor: (10n * USDC).toString(), bill: rentBill }), vaultInputs())).toBe(false);
  });

  it("returns everything only while the owner still asks for it", () => {
    const r = run(decision({ kind: "RETURN_ALL" }), true);
    expect(vaultLegAllowed(r, toOwner, decision({}), vaultInputs({}, [], [], true))).toBe(true);
    expect(vaultLegAllowed(r, toOwner, decision({}), vaultInputs({}, [], [], false))).toBe(false);
    expect(vaultLegAllowed(run(decision({ kind: "RETURN_ALL" }), false), toOwner, decision({}), vaultInputs({}, [], [], true))).toBe(false);
  });

  it("lets a de-risk withdrawal proceed while the engine would only invest or wait and Morpho can cover it", () => {
    const r = run(decision({ kind: "DE_RISK", withdrawMinor: (6n * USDC).toString() }));
    expect(vaultLegAllowed(r, deposit, decision({ kind: "NO_ACTION" }), vaultInputs({ redeemable: 6n * USDC }))).toBe(true);
    expect(vaultLegAllowed(r, deposit, decision({ kind: "LIQUIDITY_TOP_UP", transferMinor: "1" }), vaultInputs({ redeemable: 6n * USDC }))).toBe(false);
    expect(vaultLegAllowed(r, deposit, decision({ kind: "INVEST" }), vaultInputs({ redeemable: 6n * USDC - 1n }))).toBe(false);
  });

  it("never allows a leg for a NO_ACTION run", () => {
    expect(vaultLegAllowed(run(decision({})), toOwner, decision({}), vaultInputs())).toBe(false);
  });
});
