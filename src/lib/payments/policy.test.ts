import { describe, expect, it } from "vitest";
import { initialWorkspace, usdc } from "@/test/fixtures";
import { assessTreasury } from "@/lib/treasury/engine";
import { assessPayment, paymentRecipient } from "./policy";

const now = new Date("2026-10-02T00:00:00Z");
const clone = () => structuredClone(initialWorkspace);
describe("full obligation payment policy", () => {
  it("allows a protected obligation even when deployable capital is lower than its amount", () => {
    const workspace = clone(); workspace.totalTreasury = workspace.liquidUsdc = usdc("6000000000");
    expect(assessTreasury(workspace, now).deployableCapital.minorUnits).toBe("500000000");
    expect(assessPayment(workspace, workspace.obligations[0], usdc("1000"), now).status).toBe("PASS");
  });
  it("protects earlier payments, safety buffer, exact fees and coverage", () => {
    const workspace = clone(); workspace.totalTreasury = workspace.liquidUsdc = usdc("5500000000");
    expect(assessPayment(workspace, workspace.obligations[1], usdc("1"), now).status).toBe("BLOCKED");
    expect(assessPayment(workspace, workspace.obligations[1], usdc("0"), now).status).toBe("PASS");
    workspace.policy.minimumLiquidityCoverageBps = 15000;
    expect(assessPayment(workspace, workspace.obligations[1], usdc("0"), now).status).toBe("BLOCKED");
  });
  it("does not pay drafts, paid records, changed amounts or already pending obligations", () => {
    const workspace = clone(); const item = workspace.obligations[0];
    for (const status of ["DRAFT", "PAID"] as const) expect(assessPayment(workspace, { ...item, status }, usdc("0"), now).status).toBe("BLOCKED");
    expect(assessPayment(workspace, { ...item, amount: usdc("1") }, usdc("0"), now).status).toBe("BLOCKED");
    workspace.paymentReservations = [{ proposalId: "11111111-1111-4111-8111-111111111111", obligationId: item.id, amount: item.amount, feeReserve: usdc("1000") }];
    workspace.pendingTransactions = usdc("4000001000");
    expect(assessPayment(workspace, item, usdc("0"), now).status).toBe("BLOCKED");
    expect(assessTreasury(workspace, now).protectedCapital.minorUnits).toBe("5500001000");
  });
  it("rejects mixed money contracts and does not use vault funds for direct Send", () => {
    const workspace = clone();
    expect(() => assessPayment(workspace, workspace.obligations[0], { ...usdc("0"), decimals: 18 }, now)).toThrow();
    workspace.liquidUsdc = usdc("1");
    expect(assessPayment(workspace, workspace.obligations[0], usdc("0"), now).status).toBe("BLOCKED");
  });
  it("rejects zero, contract, self and invalid recipient addresses", () => {
    const wallet = "0x0000000000000000000000000000000000000001";
    for (const value of [null, "x", wallet, "0x0000000000000000000000000000000000000000", "0x3600000000000000000000000000000000000000"]) expect(() => paymentRecipient(value, wallet)).toThrow();
    expect(paymentRecipient("0x0000000000000000000000000000000000000002", wallet)).toBe("0x0000000000000000000000000000000000000002");
  });
});
