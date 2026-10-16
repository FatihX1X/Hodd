// @vitest-environment node
import { describe, expect, it } from "vitest";
import { sampleWorkspace } from "@/test/fixtures";
import type { EarnPosition } from "@/lib/earn/models";
import type { Obligation, TreasuryWorkspace } from "@/lib/treasury/models";
import { decideVault, NOTHING_TO_INVEST, routeOf, splitDeposit, vaultBillPlan, VAULT_PAY_WINDOW_MS, type VaultBill, type VaultDecisionInputs } from "./vault-decision";
import { LEGACY_VAULT_LIMITS, VAULT_LIMITS, VAULT_MORPHO } from "./vault";
import type { VaultUsyc } from "./vault-state";

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
/** The vault's USYC pool position: shares worth `value`, all of it redeemable unless patched, deposits open. */
function usyc(value: bigint, patch: Partial<VaultUsyc> = {}): VaultUsyc {
  return { shares: value * 1_000_000n, valueMinor: value, redeemableMinor: value, redeemableShares: value * 1_000_000n, depositRoomMinor: 100_000n * USDC, ready: true, afterHoursPricing: false, observedAt: now.toISOString(), ...patch };
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
    idleMinor: (50n * USDC).toString(), bills, depositRoomMinor: VAULT_LIMITS.maxDepositPerTx, paymentRoomMinor: VAULT_LIMITS.maxPaymentPerTx,
    agentGasMinor: "1000000", feeReserveMinor: "100000", now, ...patch,
  };
}
const route = (d: ReturnType<typeof decideVault>) => routeOf(d);

describe("vault decision baseline", () => {
  it("invests all of the vault's free cash: no budget, per-run cap, reserve or Morpho share binds the agent", () => {
    const decision = decideVault(inputs());
    expect(decision).toMatchObject({ kind: "INVEST", depositMinor: (50n * USDC).toString(), transferMinor: "0", withdrawMinor: "0" });
    expect(route(decision)).toMatchObject({ depositMorphoMinor: (50n * USDC).toString(), depositUsycMinor: "0" });
    const tight = inputs(); tight.mandate = { ...tight.mandate, budgetMinor: "1", maxPerRunMinor: "1", maxMorphoBps: 0, reserveMinor: "1" };
    expect(decideVault(tight).depositMinor).toBe((50n * USDC).toString());
  });

  it("does nothing while the mandate is disabled or paused, even with a bill due", () => {
    const due = [bill(obligation("rent", 10n * USDC, 12 * HOUR))];
    const paused = inputs(due); paused.mandate = { ...paused.mandate, paused: true };
    const disabled = inputs(due); disabled.mandate = { ...disabled.mandate, enabled: false };
    for (const input of [paused, disabled]) expect(decideVault(input)).toMatchObject({ kind: "NO_ACTION", transferMinor: "0", explanation: expect.stringContaining("disabled or paused") });
  });

  it("leaves less than 1 USDC of free cash alone", () => {
    expect(decideVault(inputs([], { idleMinor: "999999" }))).toMatchObject({ kind: "NO_ACTION", explanation: NOTHING_TO_INVEST });
  });
});

describe("choosing between Morpho and USYC", () => {
  it("puts new cash into the higher recent yield", () => {
    const toUsyc = decideVault(inputs([], { usyc: usyc(0n), apy: { morphoBps: 300, usycBps: 420 } }));
    expect(toUsyc).toMatchObject({ kind: "INVEST", depositMinor: (50n * USDC).toString() });
    expect(route(toUsyc)).toMatchObject({ depositMorphoMinor: "0", depositUsycMinor: (50n * USDC).toString() });
    expect(toUsyc.explanation).toContain("USYC");
    const toMorpho = decideVault(inputs([], { usyc: usyc(0n), apy: { morphoBps: 600, usycBps: 420 } }));
    expect(route(toMorpho)).toMatchObject({ depositMorphoMinor: (50n * USDC).toString(), depositUsycMinor: "0" });
  });

  it("splits evenly when the yields are within half a point, or both unknown", () => {
    for (const apy of [{ morphoBps: 400, usycBps: 420 }, { morphoBps: null, usycBps: null }]) {
      expect(route(decideVault(inputs([], { usyc: usyc(0n), apy })))).toMatchObject({ depositMorphoMinor: (25n * USDC).toString(), depositUsycMinor: (25n * USDC).toString() });
    }
  });

  it("never puts more into USYC than the pool accepts now, and sends the rest to Morpho", () => {
    const decision = decideVault(inputs([], { usyc: usyc(0n, { depositRoomMinor: 8n * USDC }), apy: { morphoBps: 100, usycBps: 400 } }));
    expect(route(decision)).toMatchObject({ depositUsycMinor: (8n * USDC).toString(), depositMorphoMinor: (42n * USDC).toString() });
  });

  it("uses only Morpho while USYC is closed, paused by Circle, stale or unreadable", () => {
    for (const pool of [usyc(0n, { depositRoomMinor: 0n }), usyc(0n, { ready: false }), usyc(0n, { observedAt: new Date(now.getTime() - 61_000).toISOString() }), null]) {
      expect(route(decideVault(inputs([], { usyc: pool, apy: { morphoBps: 100, usycBps: 900 } })))).toMatchObject({ depositMorphoMinor: (50n * USDC).toString(), depositUsycMinor: "0" });
    }
  });

  it("uses only USYC while the Morpho read is stale, and waits when neither can take a deposit", () => {
    const stale = position(0n, { observedAt: new Date(now.getTime() - 61_000).toISOString() });
    expect(route(decideVault(inputs([], { vaultPosition: stale, usyc: usyc(0n), apy: { morphoBps: 900, usycBps: 100 } })))).toMatchObject({ depositMorphoMinor: "0", depositUsycMinor: (50n * USDC).toString() });
    expect(decideVault(inputs([], { vaultPosition: stale, usyc: null }))).toMatchObject({ kind: "NO_ACTION", explanation: expect.stringContaining("Neither Morpho nor USYC") });
  });

  it("splitDeposit gives a strategy with an unknown yield nothing while the other's is known", () => {
    expect(splitDeposit(10n, { morphoRoom: 100n, usycRoom: 100n, apy: { morphoBps: 300, usycBps: null } })).toEqual({ morpho: 10n, usyc: 0n });
    expect(splitDeposit(10n, { morphoRoom: 100n, usycRoom: 100n, apy: { morphoBps: null, usycBps: 300 } })).toEqual({ morpho: 0n, usyc: 10n });
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
    expect(route(decision)).toMatchObject({ withdrawMorphoMinor: "6000000", withdrawUsycMinor: "0" });
    expect(decision.explanation).toContain("Morpho");
  });

  it("takes what Morpho cannot pay out from USYC", () => {
    const rent = obligation("rent", 10n * USDC, 12 * HOUR);
    const decision = decideVault(inputs([bill(rent)], { idleMinor: (4n * USDC).toString(), vaultPosition: position(30n * USDC, { redeemable: usdc(2n * USDC) }), usyc: usyc(20n * USDC) }));
    expect(decision).toMatchObject({ kind: "PAY_BILL", withdrawMinor: "6000000", transferMinor: "10000000" });
    expect(route(decision)).toMatchObject({ withdrawMorphoMinor: "2000000", withdrawUsycMinor: "4000000" });
    expect(decision.explanation).toContain("from USYC");
    // Only USYC holds anything.
    expect(route(decideVault(inputs([bill(rent)], { idleMinor: "0", usyc: usyc(20n * USDC) })))).toMatchObject({ withdrawMorphoMinor: "0", withdrawUsycMinor: "10000000" });
  });

  it("does not withdraw for a bill from a stale or unavailable read", () => {
    const rent = obligation("rent", 10n * USDC, 12 * HOUR);
    const stale = inputs([bill(rent)], { idleMinor: (4n * USDC).toString(), vaultPosition: position(30n * USDC, { observedAt: new Date(now.getTime() - 60_001).toISOString() }) });
    expect(decideVault(stale)).toMatchObject({ kind: "NO_ACTION", withdrawMinor: "0", transferMinor: "0", explanation: expect.stringContaining("fresh") });
    const unavailable = inputs([bill(rent)], { idleMinor: (4n * USDC).toString(), vaultPosition: position(30n * USDC, { liquidityStatus: "UNAVAILABLE" }) });
    expect(decideVault(unavailable).kind).toBe("NO_ACTION");
    const staleUsyc = inputs([bill(rent)], { idleMinor: (4n * USDC).toString(), usyc: usyc(30n * USDC, { observedAt: new Date(now.getTime() - 60_001).toISOString() }) });
    expect(decideVault(staleUsyc)).toMatchObject({ kind: "NO_ACTION", explanation: expect.stringContaining("could not be read fresh") });
  });

  it("does not pay when idle cash and redeemable positions together fall short, and says so", () => {
    const rent = obligation("rent", 10n * USDC, 12 * HOUR);
    const short = decideVault(inputs([bill(rent)], { idleMinor: (4n * USDC).toString(), vaultPosition: position(3n * USDC), usyc: usyc(2n * USDC) }));
    expect(short).toMatchObject({ kind: "NO_ACTION", transferMinor: "0", withdrawMinor: "0", explanation: expect.stringContaining("Pay it yourself") });
    // A large position that is not redeemable right now does not count.
    const locked = decideVault(inputs([bill(rent)], { idleMinor: (4n * USDC).toString(), vaultPosition: position(30n * USDC, { redeemable: usdc(5n * USDC) }) }));
    expect(locked.kind).toBe("NO_ACTION");
    const usycLimit = decideVault(inputs([bill(rent)], { idleMinor: (4n * USDC).toString(), usyc: usyc(30n * USDC, { redeemableMinor: USDC }) }));
    expect(usycLimit.kind).toBe("NO_ACTION");
  });

  it("does not pay a bill due in five days now", () => {
    // Outside both the pay window and the 3-day protection window: the cash is managed as usual.
    const decision = decideVault(inputs([bill(obligation("rent", 10n * USDC, 5 * DAY))]));
    expect(decision).toMatchObject({ kind: "INVEST", depositMinor: (50n * USDC).toString(), transferMinor: "0" });
    expect(decision.bill).toBeUndefined();
    expect(decideVault(inputs([bill(obligation("rent", 10n * USDC, VAULT_PAY_WINDOW_MS + 60_000))])).kind).not.toBe("PAY_BILL");
  });

  it("refuses a bill bigger than a payment limit the owner set and explains", () => {
    const rent = obligation("rent", 10n * USDC, 12 * HOUR);
    const decision = decideVault(inputs([bill(rent)], { paymentRoomMinor: 10n * USDC - 1n }));
    expect(decision).toMatchObject({ kind: "NO_ACTION", transferMinor: "0", depositMinor: "0" });
    expect(decision.explanation).toContain("payment limit");
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
    expect(decideVault(inputs([], { ledgerBusy: true }))).toMatchObject({ kind: "INVEST", depositMinor: (50n * USDC).toString() });
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
    const decision = decideVault(inputs([bill(obligation("rent", 49_500_000n, 2 * DAY))]));
    expect(decision).toMatchObject({ kind: "NO_ACTION", depositMinor: "0", transferMinor: "0", explanation: NOTHING_TO_INVEST });
  });

  it("only invests what is left after the kept-back amount, and says what stays", () => {
    const decision = decideVault(inputs([bill(obligation("rent", 40n * USDC, 2 * DAY))]));
    expect(decision).toMatchObject({ kind: "INVEST", depositMinor: (10n * USDC).toString() });
    expect(decision.explanation).toContain("40 USDC stays as cash for approved bills");
  });

  it("brings money back to cash for approved bills inside the protection window: Morpho first, then USYC", () => {
    const rent = bill(obligation("rent", 30n * USDC, 2 * DAY));
    const fromMorpho = decideVault(inputs([rent], { idleMinor: (10n * USDC).toString(), vaultPosition: position(40n * USDC) }));
    expect(fromMorpho).toMatchObject({ kind: "RESERVE_REFILL", withdrawMinor: (20n * USDC).toString(), depositMinor: "0", transferMinor: "0" });
    expect(route(fromMorpho)).toMatchObject({ withdrawMorphoMinor: (20n * USDC).toString(), withdrawUsycMinor: "0" });
    expect(fromMorpho.explanation).toContain("back to the vault's cash");
    const both = decideVault(inputs([rent], { idleMinor: (10n * USDC).toString(), vaultPosition: position(40n * USDC, { redeemable: usdc(5n * USDC) }), usyc: usyc(30n * USDC) }));
    expect(route(both)).toMatchObject({ withdrawMorphoMinor: (5n * USDC).toString(), withdrawUsycMinor: (15n * USDC).toString() });
    // A bill outside the window brings nothing back: the cash is invested.
    expect(decideVault(inputs([bill(obligation("rent", 30n * USDC, 10 * DAY))], { idleMinor: (10n * USDC).toString(), vaultPosition: position(40n * USDC) }))).toMatchObject({ kind: "INVEST", depositMinor: (10n * USDC).toString() });
  });

  it("does not keep cash for an approved bill due in ten days", () => {
    expect(decideVault(inputs([bill(obligation("rent", 45n * USDC, 10 * DAY))]))).toMatchObject({ kind: "INVEST", depositMinor: (50n * USDC).toString() });
  });

  it("follows an explicit protection lead time", () => {
    const input = inputs([bill(obligation("rent", 45n * USDC, 10 * DAY))]);
    input.workspace.policy.protectionLeadDays = 14;
    expect(decideVault(input).depositMinor).toBe((5n * USDC).toString());
  });

  it("does not keep cash for bills the vault will not pay", () => {
    const unapproved = bill(obligation("rent", 45n * USDC, 2 * DAY), { approved: false });
    expect(decideVault(inputs([unapproved]))).toMatchObject({ kind: "INVEST", depositMinor: (50n * USDC).toString() });
  });

  it("takes approved bills out of the owner's own protection, but leaves the others in", () => {
    // The owner holds nothing: an unapproved protected bill makes the vault top the owner up.
    const lowOwner = (item: VaultBill, patch: Partial<VaultDecisionInputs> = {}) => {
      const input = inputs([item], patch);
      input.workspace.liquidUsdc = usdc(0n); input.workspace.totalTreasury = usdc(0n); input.workspace.policy.safetyBuffer = usdc(0n);
      return input;
    };
    const unapproved = decideVault(lowOwner(bill(obligation("rent", 10n * USDC, 2 * DAY), { approved: false })));
    expect(unapproved).toMatchObject({ kind: "LIQUIDITY_TOP_UP", transferMinor: "10000000", withdrawMinor: "0" });
    // Approved, the vault keeps the 10 USDC back instead and invests the other 40.
    const approved = decideVault(lowOwner(bill(obligation("rent", 10n * USDC, 2 * DAY))));
    expect(approved).toMatchObject({ kind: "INVEST", depositMinor: (40n * USDC).toString(), transferMinor: "0", protectedMinor: "0" });
    // Without free cash the top-up redeems straight to the owner: Morpho first, then USYC.
    const fromMorpho = decideVault(lowOwner(bill(obligation("rent", 10n * USDC, 2 * DAY), { approved: false }), { idleMinor: "0", vaultPosition: position(30n * USDC), usyc: usyc(30n * USDC) }));
    expect(fromMorpho).toMatchObject({ kind: "LIQUIDITY_TOP_UP", withdrawMinor: "10000000", transferMinor: "0" });
    expect(route(fromMorpho)).toMatchObject({ withdrawMorphoMinor: "10000000", withdrawUsycMinor: "0" });
    const fromUsyc = decideVault(lowOwner(bill(obligation("rent", 10n * USDC, 2 * DAY), { approved: false }), { idleMinor: "0", usyc: usyc(30n * USDC) }));
    expect(route(fromUsyc)).toMatchObject({ withdrawMorphoMinor: "0", withdrawUsycMinor: "10000000" });
  });
});

describe("limits the owner sets on the vault", () => {
  it("never deposits more than a deposit limit the owner kept, also when it splits between the strategies", () => {
    const decision = decideVault(inputs([], { depositRoomMinor: 5n * USDC }));
    expect(decision).toMatchObject({ kind: "INVEST", depositMinor: (5n * USDC).toString() });
    const split = decideVault(inputs([], { depositRoomMinor: 10n * USDC, usyc: usyc(0n), apy: { morphoBps: 400, usycBps: 410 } }));
    expect(split).toMatchObject({ kind: "INVEST", depositMinor: (10n * USDC).toString() });
    expect(route(split)).toMatchObject({ depositMorphoMinor: (5n * USDC).toString(), depositUsycMinor: (5n * USDC).toString() });
  });

  it("does nothing when that deposit limit is used up", () => {
    expect(decideVault(inputs([], { depositRoomMinor: 0n }))).toMatchObject({ kind: "NO_ACTION", depositMinor: "0", explanation: expect.stringContaining("deposit limit you set") });
  });

  it("never plans a bill above an older vault's per-payment limit, but pays it once the limits are lifted", () => {
    const big = obligation("big", LEGACY_VAULT_LIMITS.maxPaymentPerTx + 1n, 12 * HOUR);
    const approvedHigh = bill(big, { capMinor: LEGACY_VAULT_LIMITS.maxPaymentPerTx * 2n });
    expect(vaultBillPlan(approvedHigh, LEGACY_VAULT_LIMITS.maxPaymentPerTx)).toBe("OVER_LIMIT");
    expect(decideVault(inputs([approvedHigh], { idleMinor: (2_000n * USDC).toString(), maxPaymentPerTxMinor: LEGACY_VAULT_LIMITS.maxPaymentPerTx })).kind).not.toBe("PAY_BILL");
    expect(vaultBillPlan(approvedHigh)).toBe("PAYS");
    expect(decideVault(inputs([approvedHigh], { idleMinor: (2_000n * USDC).toString() })).kind).toBe("PAY_BILL");
  });
});

describe("return all from the vault", () => {
  it("returns idle cash to the owner even with an approved bill due", () => {
    const rent = obligation("rent", 10n * USDC, 2 * HOUR);
    expect(decideVault(inputs([bill(rent)], { returnAll: true }))).toMatchObject({ kind: "RETURN_ALL", transferMinor: (50n * USDC).toString(), withdrawMinor: "0" });
  });

  it("redeems the Morpho and USYC positions, then sends the cash, even while paused or short of agent gas", () => {
    const input = inputs([bill(obligation("rent", 10n * USDC, 2 * HOUR))], { returnAll: true, vaultPosition: position(30n * USDC), usyc: usyc(20n * USDC), agentGasMinor: "0" });
    input.mandate = { ...input.mandate, paused: true };
    const decision = decideVault(input);
    expect(decision).toMatchObject({ kind: "RETURN_ALL", withdrawMinor: (50n * USDC).toString(), transferMinor: (50n * USDC).toString() });
    expect(route(decision)).toMatchObject({ withdrawMorphoMinor: (30n * USDC).toString(), withdrawUsycMinor: (20n * USDC).toString() });
  });

  it("returns what it can while Circle pauses USYC, waits for a fresh Morpho read, and says when the vault is empty", () => {
    const paused = decideVault(inputs([], { returnAll: true, vaultPosition: position(30n * USDC), usyc: usyc(5n * USDC, { ready: false }) }));
    expect(paused).toMatchObject({ kind: "RETURN_ALL", withdrawMinor: (30n * USDC).toString(), transferMinor: (50n * USDC).toString(), explanation: expect.stringContaining("USYC position stays") });
    expect(route(paused)).toMatchObject({ withdrawMorphoMinor: (30n * USDC).toString(), withdrawUsycMinor: "0" });
    // An unreadable pool still counts the shares: never "nothing to return".
    const unreadable = usyc(0n, { shares: 7n, valueMinor: 0n, redeemableMinor: 0n, redeemableShares: 0n, depositRoomMinor: 0n, ready: false, readable: false });
    expect(decideVault(inputs([], { returnAll: true, idleMinor: "0", usyc: unreadable }))).toMatchObject({ kind: "NO_ACTION", explanation: expect.stringContaining("cannot be redeemed right now") });
    // A bill that needs that USYC waits for a fresh read instead of being left to the owner.
    expect(decideVault(inputs([bill(obligation("rent", 10n * USDC, 12 * HOUR))], { idleMinor: "0", usyc: unreadable }))).toMatchObject({ kind: "NO_ACTION", explanation: expect.stringContaining("could not be read fresh") });
    expect(decideVault(inputs([], { returnAll: true, vaultPosition: position(5n * USDC, { liquidityStatus: "UNAVAILABLE" }) }))).toMatchObject({ kind: "NO_ACTION", explanation: expect.stringContaining("Morpho") });
    expect(decideVault(inputs([], { returnAll: true, idleMinor: "0" }))).toMatchObject({ kind: "NO_ACTION", explanation: expect.stringContaining("empty") });
  });

  it("keeps nothing back for bills when returning", () => {
    const decision = decideVault(inputs([bill(obligation("rent", 45n * USDC, 2 * DAY))], { returnAll: true }));
    expect(decision).toMatchObject({ kind: "RETURN_ALL", transferMinor: (50n * USDC).toString() });
  });
});

describe("vault decision edge cases", () => {
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
