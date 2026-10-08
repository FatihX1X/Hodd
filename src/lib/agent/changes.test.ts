import { describe, expect, it } from "vitest";
import { initialWorkspace } from "@/lib/treasury/fixtures";
import type { TreasuryWorkspace } from "@/lib/treasury/models";
import { applyChange } from "./changes";
import { paymentCheckView } from "./views";

const now = new Date("2026-10-01T09:00:00.000Z");
const fresh = (): TreasuryWorkspace => structuredClone(initialWorkspace);
const recipient = "0x3406584CCD8cc2fa38BfD3ece96d5dD4371B0040";

describe("connector workspace changes", () => {
  it("creates an obligation with revision 1 and an AGENT activity approved in Claude", () => {
    const result = applyChange(fresh(), "CREATE_OBLIGATION", { title: "Office rent", amount: "1500.5", dueDate: "2026-10-20", category: "RENT", recipientAddress: recipient.toLowerCase() }, now, () => "new-id");
    const created = result.workspace.obligations.find((item) => item.id === "new-id")!;
    expect(created).toMatchObject({ title: "Office rent", amount: { currency: "USDC", decimals: 6, minorUnits: "1500500000" }, dueAt: "2026-10-20T17:00:00.000Z", status: "UPCOMING", priority: "NORMAL", revision: 1, recipientAddress: recipient });
    expect(result.workspace.activities[0]).toMatchObject({ actor: "AGENT", approval: "APPROVED", action: "Obligation created via Claude" });
    expect(result.workspace.updatedAt).toBe(now.toISOString());
  });
  it("updates an obligation with revision +1 and lists exactly what changed", () => {
    const workspace = fresh(); workspace.obligations[0].revision = 3;
    const result = applyChange(workspace, "UPDATE_OBLIGATION", { obligationId: workspace.obligations[0].id, amount: "10", status: "DRAFT" }, now);
    const updated = result.workspace.obligations[0];
    expect(updated.revision).toBe(4); expect(updated.status).toBe("DRAFT"); expect(updated.amount.minorUnits).toBe("10000000");
    expect(result.lines.some((line) => line.startsWith("Amount:"))).toBe(true);
    expect(result.lines.some((line) => line.startsWith("Status:"))).toBe(true);
    expect(() => applyChange(workspace, "UPDATE_OBLIGATION", { obligationId: workspace.obligations[0].id, title: workspace.obligations[0].title }, now)).toThrow("Nothing would change");
  });
  it("refuses paid obligations, PAID status, unknown ids and changes while a payment is pending", () => {
    const workspace = fresh(); workspace.obligations[0].status = "PAID";
    expect(() => applyChange(workspace, "UPDATE_OBLIGATION", { obligationId: workspace.obligations[0].id, amount: "1" }, now)).toThrow("Paid obligations");
    expect(() => applyChange(fresh(), "UPDATE_OBLIGATION", { obligationId: "nope", amount: "1" }, now)).toThrow("No obligation");
    expect(() => applyChange(fresh(), "UPDATE_OBLIGATION", { obligationId: "obl-aws-oct", status: "PAID" }, now)).toThrow();
    const pending = fresh(); pending.paymentReservations = [{ proposalId: "11111111-1111-4111-8111-111111111111", obligationId: "obl-aws-oct", amount: pending.obligations[1].amount, feeReserve: pending.obligations[1].amount }];
    expect(() => applyChange(pending, "UPDATE_POLICY", { safetyBuffer: "1" }, now)).toThrow("payment is pending");
    expect(() => applyChange(pending, "CREATE_OBLIGATION", { title: "x", amount: "1", dueDate: "2026-10-20" }, now)).toThrow("payment is pending");
  });
  it("updates policy fields (including a zero buffer) and validates allocation targets", () => {
    const result = applyChange(fresh(), "UPDATE_POLICY", { safetyBuffer: "0", minimumLiquidityCoverageBps: 15000, strategyCapsBps: { MORPHO: 4000 }, enabledStrategies: { USYC: false } }, now);
    expect(result.workspace.policy.safetyBuffer.minorUnits).toBe("0");
    expect(result.workspace.policy.minimumLiquidityCoverageBps).toBe(15000);
    expect(result.workspace.policy.strategyCapsBps.MORPHO).toBe(4000);
    expect(result.workspace.policy.enabledStrategies.USYC).toBe(false);
    expect(applyChange(fresh(), "SET_TARGETS", { targetsBps: { LIQUID: 4000, MORPHO: 6000, USYC: 0, BTC_RESERVE: 0 } }, now).workspace.targetAllocationsBps.MORPHO).toBe(6000);
    expect(() => applyChange(fresh(), "SET_TARGETS", { targetsBps: { LIQUID: 4000, MORPHO: 5000, USYC: 0, BTC_RESERVE: 0 } }, now)).toThrow("total 10000");
  });
  it("money requests never change balances or obligations, only record the request", () => {
    const workspace = fresh(); workspace.obligations[1].recipientAddress = recipient;
    const payment = applyChange(workspace, "PAYMENT_REQUEST", { obligationId: "obl-aws-oct" }, now);
    expect(payment.workspace.obligations).toEqual(workspace.obligations);
    expect(payment.workspace.liquidUsdc).toEqual(workspace.liquidUsdc);
    expect(payment.workspace.activities[0].action).toBe("Payment requested via Claude");
    expect(() => applyChange(fresh(), "PAYMENT_REQUEST", { obligationId: "obl-aws-oct" }, now)).toThrow("no recipient address");
    expect(() => applyChange(fresh(), "PAYMENT_REQUEST", { obligationId: "obl-invoice-104" }, now)).toThrow("Only upcoming");
    expect(() => applyChange(fresh(), "EARN_REQUEST", { operation: "DEPOSIT" }, now)).toThrow("amount is required");
    expect(applyChange(fresh(), "EARN_REQUEST", { operation: "REDEEM_ALL" }, now).summary).toContain("Redeem all");
  });
  it("rejects malformed values", () => {
    expect(() => applyChange(fresh(), "CREATE_OBLIGATION", { title: "x", amount: "1.1234567", dueDate: "2026-10-20" }, now)).toThrow();
    expect(() => applyChange(fresh(), "CREATE_OBLIGATION", { title: "x", amount: "5", dueDate: "20.10.2026" }, now)).toThrow();
    expect(() => applyChange(fresh(), "CREATE_OBLIGATION", { title: "x", amount: "5", dueDate: "2026-10-20", recipientAddress: "0x123" }, now)).toThrow();
    expect(() => applyChange(fresh(), "CREATE_OBLIGATION", { title: "x", amount: "5", dueDate: "2026-10-20", unknownField: 1 }, now)).toThrow();
  });
});

describe("can I pay it?", () => {
  const fee = { currency: "USDC" as const, decimals: 6, minorUnits: "5000" };
  it("passes when liquid USDC covers the bill, the buffer and earlier bills", () => {
    const workspace = fresh();
    const check = paymentCheckView(workspace, workspace.obligations[1], fee, now);
    expect(check.funding.action).toBe(check.canPayNow ? "NONE" : check.funding.action);
    expect(check.estimatedFee).toBe("0.005 USDC");
  });
  it("suggests a Morpho withdrawal when liquid USDC is short but redeemable funds cover it", () => {
    const workspace = fresh();
    const morpho = workspace.strategies.find((item) => item.kind === "MORPHO")!;
    morpho.integration = "LIVE"; morpho.redeemable = { currency: "USDC", decimals: 6, minorUnits: "1000000000000" };
    workspace.liquidUsdc = { currency: "USDC", decimals: 6, minorUnits: "1000000" };
    const check = paymentCheckView(workspace, workspace.obligations[1], fee, now);
    expect(check.canPayNow).toBe(false);
    expect(check.funding.action).toBe("WITHDRAW_FROM_MORPHO");
    workspace.strategies.find((item) => item.kind === "MORPHO")!.redeemable = { currency: "USDC", decimals: 6, minorUnits: "0" };
    expect(paymentCheckView(workspace, workspace.obligations[1], fee, now).funding.action).toBe("INSUFFICIENT");
  });
});
