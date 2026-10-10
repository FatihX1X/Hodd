import { describe, expect, it } from "vitest";
import { sampleWorkspace, usdc } from "@/test/fixtures";
import { canDeleteObligation, hasSampleData, removeSampleData } from "./sample-cleanup";
import { createLiveStarterWorkspace } from "./starter";
import { treasuryWorkspaceSchema } from "./models";

const now = "2026-10-09T12:00:00.000Z";
describe("sample cleanup", () => {
  it("removes fixture IDs, resets unchanged sample settings and leaves inputs untouched", () => {
    const before = structuredClone(sampleWorkspace);
    const output = removeSampleData(before, now);
    expect(before).toEqual(sampleWorkspace);
    expect(hasSampleData(before)).toBe(true); expect(hasSampleData(output)).toBe(false);
    expect(output.obligations).toEqual([]); expect(output.activities).toEqual([expect.objectContaining({ actor: "SYSTEM", action: "Sample records removed" })]); expect(output.decisions).toEqual([]);
    expect(output.policy.safetyBuffer).toEqual(usdc("1000000"));
    expect(output.targetAllocationsBps).toEqual(createLiveStarterWorkspace(now).targetAllocationsBps);
    expect(treasuryWorkspaceSchema.safeParse(output).success).toBe(true);
  });
  it("preserves paid, referenced, reserved and user-authored bills and changed settings", () => {
    const input = structuredClone(sampleWorkspace);
    input.obligations[0].status = "PAID";
    input.obligations[1].paymentReference = "00000000-0000-4000-8000-000000000001";
    input.paymentReservations = [{ proposalId: "00000000-0000-4000-8000-000000000002", obligationId: input.obligations[2].id, amount: usdc("1"), feeReserve: usdc("0") }];
    input.obligations.push({ ...input.obligations[2], id: "my-bill" });
    input.activities.push({ ...input.activities[0], id: "my-activity" });
    input.decisions.push({ ...input.decisions[0], id: "my-decision" });
    input.policy.safetyBuffer = usdc("2000000");
    input.targetAllocationsBps = { LIQUID: 6000, MORPHO: 4000, USYC: 0, BTC_RESERVE: 0 };
    const output = removeSampleData(input, now);
    expect(output.obligations).toEqual(input.obligations);
    expect(output.activities.map((item) => item.action)).toContain("Sample records removed");
    expect(output.activities.slice(1).map((item) => item.id)).toEqual(["my-activity"]);
    expect(output.decisions.map((item) => item.id)).toEqual(["my-decision"]);
    expect(output.targetAllocationsBps).toEqual(input.targetAllocationsBps); expect(output.policy).toEqual(input.policy);
    expect(canDeleteObligation(input, input.obligations[0])).toBe(false);
    expect(canDeleteObligation(input, input.obligations[1])).toBe(false);
    expect(canDeleteObligation(input, input.obligations[2])).toBe(false);
    expect(canDeleteObligation(input, input.obligations[3])).toBe(true);
  });
  it("is idempotent and recognizes an empty starter", () => {
    const starter = createLiveStarterWorkspace(now); expect(hasSampleData(starter)).toBe(false);
    const cleaned = removeSampleData(sampleWorkspace, now);
    expect(removeSampleData(cleaned, now)).toEqual(cleaned);
  });
});

describe("automatic cleanup never rewrites a user's own policy", () => {
  it("keeps a deliberately chosen 1,000 USDC buffer when no legacy record remains", () => {
    const own = createLiveStarterWorkspace(now);
    own.policy.safetyBuffer = usdc("1000000000");
    expect(hasSampleData(own)).toBe(false);
    expect(removeSampleData(own, now)).toEqual(own);
  });
});
