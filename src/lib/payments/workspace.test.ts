import { describe, expect, it } from "vitest";
import { initialWorkspace, usdc } from "@/lib/treasury/fixtures";
import { mergePaymentLedger } from "./workspace";
describe("authoritative payment facts", () => {
  it("does not let a newer local cache revert a server PAID record", () => {
    const local = structuredClone(initialWorkspace); const cloud = structuredClone(initialWorkspace);
    cloud.obligations[0] = { ...cloud.obligations[0], status: "PAID", paymentReference: "11111111-1111-4111-8111-111111111111" };
    local.updatedAt = "2099-01-01T00:00:00Z";
    const merged = mergePaymentLedger(local, cloud);
    expect(merged.obligations[0]).toEqual(cloud.obligations[0]);
    expect(merged.policy).toEqual(local.policy);
  });
  it("rejects local PAID forgery and local reservation changes", () => {
    const local = structuredClone(initialWorkspace); const cloud = structuredClone(initialWorkspace);
    local.obligations[0].status = "PAID"; local.pendingTransactions = usdc("9000000000");
    expect(mergePaymentLedger(local, cloud).obligations[0].status).toBe("UPCOMING");
    expect(mergePaymentLedger(local, cloud).pendingTransactions.minorUnits).toBe("0");
  });
});
