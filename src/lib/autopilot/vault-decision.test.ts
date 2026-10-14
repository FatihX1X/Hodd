// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/test/fixtures";
import type { EarnPosition } from "@/lib/earn/models";
import type { Obligation, TreasuryWorkspace } from "@/lib/treasury/models";
import { decideVault, vaultBillPlan, VAULT_PAY_WINDOW_MS, type VaultBill, type VaultDecisionInputs } from "./vault-decision";
import { VAULT_LIMITS, VAULT_MORPHO } from "./vault";

const now = new Date("2026-10-14T12:00:00.000Z");
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const USDC = 1_000_000n;
const vaultAddress = "0x3333333333333333333333333333333333333333";
const recipient = "0x4444444444444444444444444444444444444444";
const usdc = (minor: bigint) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits: minor.toString() });

function position(balance: bigint, patch: Partial<EarnPosition> = {}): EarnPosition {
  return { walletAddress: vaultAddress, vaultAddress: VAULT_MORPHO, vaultName: "Morpho", currentBalance: usdc(balance), maxWithdrawable: usdc(balance), redeemable: usdc(balance), liquidityStatus: "READY", shares: balance.toString(), apyBps: 500, pnl: { status: "UNAVAILABLE", reason: "No history" }, observedAt: now.toISOString(), ...patch };
}
function obligation(id: string, amount: bigint, dueInMs: number, patch: Partial<Obligation> = {}): Obligation {
  return { id, title: `Bill ${id}`, category: "VENDOR", amount: usdc(amount), dueAt: new Date(now.getTime() + dueInMs).toISOString(), recipient: "Vendor", priority: "HIGH", status: "UPCOMING", description: "", recipientAddress: recipient, ...patch };
}
/** An approved bill (cap = amount) unless patched. */
function bill(o: Obligation, patch: Partial<VaultBill> = {}): VaultBill {
  return { obligation: o, approved: true, capMinor: BigInt(o.amount.minorUnits), busy: false, ...patch };
}
function workspace(obligations: Obligation[]): TreasuryWorkspace {
  const w = structuredClone(sampleWorkspace);
  w.obligations = obligations;
  return w;
}
function inputs(bills: VaultBill[] = [], patch: Partial<VaultDecisionInputs> = {}): VaultDecisionInputs {
  return {
    workspace: workspace(bills.map((item) => item.obligation)), ownerPositions: [], vaultPosition: position(0n),
    mandate: { budgetMinor: "50000000", reserveMinor: "5000000", maxPerRunMinor: "20000000", maxMorphoBps: 4000, enabled: true, paused: false },
    idleMinor: (50n * USDC).toString(), spentMinor: "0", bills, depositRoomMinor: VAULT_LIMITS.maxDepositPerTx, paymentRoomMinor: VAULT_LIMITS.maxPaymentPerTx,
    agentGasMinor: "1000000", feeReserveMinor: "100000", now, ...patch,
  };
}

describe("vault decision baseline", () => {
  it("invests idle vault cash like the custodial engine when no bill is due", () => {
    expect(decideVault(inputs())).toMatchObject({ kind: "INVEST", depositMinor: (20n * USDC).toString(), transferMinor: "0", withdrawMinor: "0" });
  });

  it("does nothing while the mandate is disabled or paused, even with a bill due", () => {
    const due = [bill(obligation("rent", 10n * USDC, 12 * HOUR))];
    const paused = inputs(due); paused.mandate = { ...paused.mandate, paused: true };
    const disabled = inputs(due); disabled.mandate = { ...disabled.mandate, enabled: false };
    for (const input of [paused, disabled]) expect(decideVault(input)).toMatchObject({ kind: "NO_ACTION", transferMinor: "0", explanation: expect.stringContaining("disabled or paused") });
  });
});

describe("vault bill payments", () => {
  it("pays an approved bill due within a day from idle cash with a transfer only", () => {
    const rent = obligation("rent", 10n * USDC, 12 * HOUR);
    const decision = decideVault(inputs([bill(rent)]));
    expect(decision).toMatchObject({ kind: "PAY_BILL", transferMinor: "10000000", withdrawMinor: "0", depositMinor: "0", bill: { obligationId: "rent", recipient, amountMinor: "10000000", dueAt: rent.dueAt } });
    expect(decision.explanation).toContain("falls due within a day");
  });

  it("pays an overdue bill or one due right now at once", () => {
    const overdue = obligation("late", 10n * USDC, -2 * DAY, { status: "OVERDUE" });
    expect(decideVault(inputs([bill(overdue)]))).toMatchObject({ kind: "PAY_BILL", transferMinor: "10000000", explanation: expect.stringContaining("is due now") });
    const today = obligation("today", 10n * USDC, -HOUR);
    expect(decideVault(inputs([bill(today)]))).toMatchObject({ kind: "PAY_BILL", bill: { obligationId: "today" }, explanation: expect.stringContaining("is due now") });
    const edge = obligation("edge", 10n * USDC, VAULT_PAY_WINDOW_MS);
    expect(decideVault(inputs([bill(edge)])).kind).toBe("PAY_BILL");
  });

  it("pays the earliest due bill first", () => {
    const later = obligation("later", 3n * USDC, 20 * HOUR), sooner = obligation("sooner", 4n * USDC, 2 * HOUR);
    expect(decideVault(inputs([bill(later), bill(sooner)])).bill?.obligationId).toBe("sooner");
  });

  it("withdraws only the missing part from Morpho when idle cash is short", () => {
    const rent = obligation("rent", 10n * USDC, 12 * HOUR);
    const decision = decideVault(inputs([bill(rent)], { idleMinor: (4n * USDC).toString(), vaultPosition: position(30n * USDC) }));
    expect(decision).toMatchObject({ kind: "PAY_BILL", withdrawMinor: "6000000", transferMinor: "10000000", depositMinor: "0", bill: { obligationId: "rent", amountMinor: "10000000" } });
    expect(decision.explanation).toContain("Morpho");
  });

  it("does not withdraw for a bill from a stale or unavailable Morpho read", () => {
    const rent = obligation("rent", 10n * USDC, 12 * HOUR);
    const stale = inputs([bill(rent)], { idleMinor: (4n * USDC).toString(), vaultPosition: position(30n * USDC, { observedAt: new Date(now.getTime() - 60_001).toISOString() }) });
    expect(decideVault(stale)).toMatchObject({ kind: "NO_ACTION", withdrawMinor: "0", transferMinor: "0", explanation: expect.stringContaining("fresh") });
    const unavailable = inputs([bill(rent)], { idleMinor: (4n * USDC).toString(), vaultPosition: position(30n * USDC, { liquidityStatus: "UNAVAILABLE" }) });
    expect(decideVault(unavailable).kind).toBe("NO_ACTION");
  });

  it("does not pay when idle cash and redeemable Morpho together fall short, and says so", () => {
    const rent = obligation("rent", 10n * USDC, 12 * HOUR);
    const short = decideVault(inputs([bill(rent)], { idleMinor: (4n * USDC).toString(), vaultPosition: position(5n * USDC) }));
    expect(short).toMatchObject({ kind: "NO_ACTION", transferMinor: "0", withdrawMinor: "0", explanation: expect.stringContaining("Pay it yourself") });
    // A large position that is not redeemable right now does not count.
    const locked = decideVault(inputs([bill(rent)], { idleMinor: (4n * USDC).toString(), vaultPosition: position(30n * USDC, { redeemable: usdc(5n * USDC) }) }));
    expect(locked.kind).toBe("NO_ACTION");
  });

  it("does not pay a bill due in five days now", () => {
    // Outside both the pay window and the 3-day protection window: the cash is managed as usual.
    const decision = decideVault(inputs([bill(obligation("rent", 10n * USDC, 5 * DAY))]));
    expect(decision).toMatchObject({ kind: "INVEST", depositMinor: (20n * USDC).toString(), transferMinor: "0" });
    expect(decision.bill).toBeUndefined();
    expect(decideVault(inputs([bill(obligation("rent", 10n * USDC, VAULT_PAY_WINDOW_MS + 60_000))])).kind).not.toBe("PAY_BILL");
  });

  it("refuses a bill bigger than the vault's 24-hour payment room and explains", () => {
    const rent = obligation("rent", 10n * USDC, 12 * HOUR);
    const decision = decideVault(inputs([bill(rent)], { paymentRoomMinor: 10n * USDC - 1n }));
    expect(decision).toMatchObject({ kind: "NO_ACTION", transferMinor: "0", depositMinor: "0" });
    expect(decision.explanation).toContain("24-hour payment budget");
    expect(decideVault(inputs([bill(rent)], { paymentRoomMinor: 10n * USDC })).kind).toBe("PAY_BILL");
  });

  it("skips a bill that does not fit the payment room but pays a smaller due bill that does", () => {
    const big = obligation("big", 10n * USDC, 2 * HOUR), small = obligation("small", 5n * USDC, 12 * HOUR);
    expect(decideVault(inputs([bill(big), bill(small)], { paymentRoomMinor: 8n * USDC }))).toMatchObject({ kind: "PAY_BILL", transferMinor: "5000000", bill: { obligationId: "small" } });
  });

  it("does not pay while another payment of the user is still open in the ledger", () => {
    const rent = obligation("rent", 10n * USDC, 12 * HOUR);
    const decision = decideVault(inputs([bill(rent)], { ledgerBusy: true }));
    expect(decision).toMatchObject({ kind: "NO_ACTION", transferMinor: "0", withdrawMinor: "0", depositMinor: "0", explanation: expect.stringContaining("another payment is still being confirmed") });
    expect(decision.bill).toBeUndefined();
    // Also when the bill would need a Morpho withdrawal first.
    expect(decideVault(inputs([bill(rent)], { ledgerBusy: true, idleMinor: (4n * USDC).toString(), vaultPosition: position(30n * USDC) })).kind).toBe("NO_ACTION");
    expect(decideVault(inputs([bill(rent)], { ledgerBusy: false })).kind).toBe("PAY_BILL");
  });

  it("keeps managing the vault while the ledger is busy if no vault-payable bill is due", () => {
    expect(decideVault(inputs([], { ledgerBusy: true }))).toMatchObject({ kind: "INVEST", depositMinor: (20n * USDC).toString() });
    expect(decideVault(inputs([bill(obligation("rent", 10n * USDC, 5 * DAY))], { ledgerBusy: true })).kind).toBe("INVEST");
    expect(decideVault(inputs([bill(obligation("rent", 10n * USDC, 12 * HOUR), { approved: false })], { ledgerBusy: true })).kind).toBe("INVEST");
  });

  it("returns everything even while the ledger is busy", () => {
    expect(decideVault(inputs([bill(obligation("rent", 10n * USDC, 12 * HOUR))], { ledgerBusy: true, returnAll: true }))).toMatchObject({ kind: "RETURN_ALL", transferMinor: (50n * USDC).toString() });
  });

  it("waits when the agent wallet cannot pay network fees, even with a bill due", () => {
    const rent = obligation("rent", 10n * USDC, 12 * HOUR);
    const decision = decideVault(inputs([bill(rent)], { agentGasMinor: "99999", feeReserveMinor: "100000" }));
    expect(decision).toMatchObject({ kind: "NO_ACTION", transferMinor: "0", depositMinor: "0", explanation: expect.stringContaining("network fees") });
    expect(decideVault(inputs([], { agentGasMinor: "0" })).kind).toBe("NO_ACTION");
    expect(decideVault(inputs([bill(rent)], { agentGasMinor: "100000", feeReserveMinor: "100000" })).kind).toBe("PAY_BILL");
  });
});

describe("bills the vault does not pay", () => {
  const amount = 10n * USDC;
  const cases: [string, VaultBill, ReturnType<typeof vaultBillPlan>][] = [
    ["unapproved", bill(obligation("a", amount, 12 * HOUR), { approved: false, capMinor: amount }), "NEEDS_APPROVAL"],
    ["cap too low", bill(obligation("b", amount, 12 * HOUR), { capMinor: amount - 1n }), "CAP_TOO_LOW"],
    ["no recipient", bill(obligation("c", amount, 12 * HOUR, { recipientAddress: null })), "NO_RECIPIENT"],
    ["recipient missing", bill(obligation("d", amount, 12 * HOUR, { recipientAddress: undefined })), "NO_RECIPIENT"],
    ["busy", bill(obligation("e", amount, 12 * HOUR), { busy: true }), "IN_FLIGHT"],
  ];

  it.each(cases)("labels a %s bill and never pays it", (_, item, plan) => {
    expect(vaultBillPlan(item)).toBe(plan);
    const decision = decideVault(inputs([item]));
    expect(decision.kind).not.toBe("PAY_BILL");
    expect(decision.bill).toBeUndefined();
  });

  it("labels an approved bill within its cap as PAYS", () => {
    expect(vaultBillPlan(bill(obligation("ok", amount, DAY)))).toBe("PAYS");
    expect(vaultBillPlan(bill(obligation("ok", amount, DAY), { capMinor: amount * 2n }))).toBe("PAYS");
  });

  it("checks the recipient before an open payment, and an open payment before approval", () => {
    expect(vaultBillPlan(bill(obligation("x", amount, DAY, { recipientAddress: null }), { busy: true, approved: false }))).toBe("NO_RECIPIENT");
    expect(vaultBillPlan(bill(obligation("x", amount, DAY), { busy: true, approved: false }))).toBe("IN_FLIGHT");
  });

  it("never pays a bill that is paid or still a draft", () => {
    for (const status of ["PAID", "DRAFT"] as const) {
      const decision = decideVault(inputs([bill(obligation("done", amount, 2 * HOUR, { status }))]));
      expect(decision.kind).not.toBe("PAY_BILL");
    }
  });
});

describe("cash kept back for approved bills", () => {
  // Autopilot active and no explicit lead: the protection window is 3 days.
  it("keeps cash for an approved bill due in two days instead of investing it", () => {
    // 50 idle - 45 kept back leaves exactly the 5 USDC reserve: nothing to invest.
    const decision = decideVault(inputs([bill(obligation("rent", 45n * USDC, 2 * DAY))]));
    expect(decision).toMatchObject({ kind: "NO_ACTION", depositMinor: "0", transferMinor: "0", explanation: expect.stringContaining("no investable budget") });
  });

  it("only invests what is left after the kept-back amount", () => {
    // 50 idle - 40 kept back = 10 managed: 40% Morpho cap of 10 = 4 USDC.
    const decision = decideVault(inputs([bill(obligation("rent", 40n * USDC, 2 * DAY))]));
    expect(decision).toMatchObject({ kind: "INVEST", depositMinor: (4n * USDC).toString() });
    expect(BigInt(decision.depositMinor)).toBeLessThanOrEqual(10n * USDC);
  });

  it("does not keep cash for an approved bill due in ten days", () => {
    expect(decideVault(inputs([bill(obligation("rent", 45n * USDC, 10 * DAY))]))).toMatchObject({ kind: "INVEST", depositMinor: (20n * USDC).toString() });
  });

  it("follows an explicit protection lead time", () => {
    const input = inputs([bill(obligation("rent", 45n * USDC, 10 * DAY))]);
    input.workspace.policy.protectionLeadDays = 14;
    expect(decideVault(input).depositMinor).toBe("0");
  });

  it("does not keep cash for bills the vault will not pay", () => {
    const unapproved = bill(obligation("rent", 45n * USDC, 2 * DAY), { approved: false });
    expect(decideVault(inputs([unapproved]))).toMatchObject({ kind: "INVEST", depositMinor: (20n * USDC).toString() });
  });

  it("takes approved bills out of the owner's own protection, but leaves the others in", () => {
    // The owner holds nothing: an unapproved protected bill makes the engine top the owner up from the vault.
    const lowOwner = (item: VaultBill) => {
      const input = inputs([item]);
      input.workspace.liquidUsdc = usdc(0n); input.workspace.totalTreasury = usdc(0n); input.workspace.policy.safetyBuffer = usdc(0n);
      return input;
    };
    const unapproved = decideVault(lowOwner(bill(obligation("rent", 10n * USDC, 2 * DAY), { approved: false })));
    expect(unapproved).toMatchObject({ kind: "LIQUIDITY_TOP_UP", transferMinor: "10000000" });
    // Approved, the vault keeps the 10 USDC back instead and manages the other 40 (40% Morpho cap = 16).
    const approved = decideVault(lowOwner(bill(obligation("rent", 10n * USDC, 2 * DAY))));
    expect(approved).toMatchObject({ kind: "INVEST", depositMinor: (16n * USDC).toString(), transferMinor: "0", protectedMinor: "0" });
  });
});

describe("vault deposit room", () => {
  it("caps an investment at the vault's 24-hour deposit room", () => {
    const decision = decideVault(inputs([], { depositRoomMinor: 5n * USDC }));
    expect(decision).toMatchObject({ kind: "INVEST", depositMinor: (5n * USDC).toString() });
    expect(decision.explanation).toContain("Capped by the vault's 24-hour deposit limit");
    expect(decideVault(inputs([], { depositRoomMinor: 20n * USDC }))).toMatchObject({ kind: "INVEST", depositMinor: (20n * USDC).toString(), explanation: expect.not.stringContaining("Capped") });
  });

  it("does nothing when the deposit room is used up", () => {
    expect(decideVault(inputs([], { depositRoomMinor: 0n }))).toMatchObject({ kind: "NO_ACTION", depositMinor: "0", explanation: expect.stringContaining("deposit limit is used up") });
  });
});

describe("return all from the vault", () => {
  it("returns idle cash to the owner even with an approved bill due", () => {
    const rent = obligation("rent", 10n * USDC, 2 * HOUR);
    expect(decideVault(inputs([bill(rent)], { returnAll: true }))).toMatchObject({ kind: "RETURN_ALL", transferMinor: (50n * USDC).toString(), withdrawMinor: "0" });
  });

  it("withdraws the Morpho position first, even while paused or short of agent gas", () => {
    const input = inputs([bill(obligation("rent", 10n * USDC, 2 * HOUR))], { returnAll: true, vaultPosition: position(30n * USDC), agentGasMinor: "0" });
    input.mandate = { ...input.mandate, paused: true };
    expect(decideVault(input)).toMatchObject({ kind: "RETURN_ALL", withdrawMinor: (30n * USDC).toString(), transferMinor: "0" });
  });

  it("keeps nothing back for bills when returning", () => {
    const decision = decideVault(inputs([bill(obligation("rent", 45n * USDC, 2 * DAY))], { returnAll: true }));
    expect(decision).toMatchObject({ kind: "RETURN_ALL", transferMinor: (50n * USDC).toString() });
  });
});

describe("vault decision edge cases", () => {
  it("never plans a bill above the contract's per-payment limit, whatever cap the recipient has", () => {
    const big = obligation("big", VAULT_LIMITS.maxPaymentPerTx + 1n, 12 * HOUR);
    const approvedHigh = bill(big, { capMinor: VAULT_LIMITS.maxPaymentPerTx * 2n });
    expect(vaultBillPlan(approvedHigh)).toBe("OVER_LIMIT");
    expect(decideVault(inputs([approvedHigh], { idleMinor: (2_000n * USDC).toString() })).kind).not.toBe("PAY_BILL");
  });

  it("still pays a bill that cash covers while another needs a Morpho position that is not fresh", () => {
    const needsMorpho = obligation("a-needs-morpho", 30n * USDC, 6 * HOUR);
    const cashCovers = obligation("b-cash", 5n * USDC, 12 * HOUR);
    const decision = decideVault(inputs([bill(needsMorpho), bill(cashCovers)], { idleMinor: (10n * USDC).toString(), vaultPosition: position(40n * USDC, { observedAt: new Date(now.getTime() - 5 * 60_000).toISOString() }) }));
    expect(decision).toMatchObject({ kind: "PAY_BILL", bill: { obligationId: "b-cash" }, withdrawMinor: "0" });
  });

  it("treats a Morpho read stamped in the future as stale", () => {
    const due = obligation("rent", 30n * USDC, 6 * HOUR);
    const decision = decideVault(inputs([bill(due)], { idleMinor: (10n * USDC).toString(), vaultPosition: position(40n * USDC, { observedAt: new Date(now.getTime() + 60_000).toISOString() }) }));
    expect(decision).toMatchObject({ kind: "NO_ACTION", explanation: expect.stringContaining("could not be read fresh") });
  });
});

describe("custodial funds", () => {
  it("moves what the custodial agent still holds into the vault before anything else, keeping its fee float", () => {
    const due = [bill(obligation("rent", 10n * USDC, 6 * HOUR))];
    const decision = decideVault(inputs(due, { custodial: { shares: 19_942_138_980_429_123_206n, positionMinor: 19_963_245n, cashMinor: 20_025_098n } }));
    expect(decision).toMatchObject({ kind: "MOVE_TO_VAULT", withdrawMinor: "19963245", transferMinor: "19525098" });
  });
  it("leaves a fee float alone and moves nothing while the mandate is paused", () => {
    expect(decideVault(inputs([], { custodial: { shares: 0n, positionMinor: 0n, cashMinor: 600_000n } })).kind).not.toBe("MOVE_TO_VAULT");
    const paused = inputs([], { custodial: { shares: 5n, positionMinor: 5n, cashMinor: 0n } }); paused.mandate = { ...paused.mandate, paused: true };
    expect(decideVault(paused).kind).toBe("NO_ACTION");
  });
});
