import { describe, expect, it } from "vitest";
import { createLiveStarterWorkspace } from "./starter";
import { treasuryWorkspaceSchema } from "./models";
import { assessTreasury, previewAllocation } from "./engine";

const now = "2026-10-09T12:00:00.000Z";
describe("live starter", () => {
  it("starts empty with valid testnet policy and no invented yield", () => {
    const workspace = createLiveStarterWorkspace(now);
    expect(treasuryWorkspaceSchema.safeParse(workspace).success).toBe(true);
    expect(workspace).toMatchObject({ treasuryMode: "LOCAL_DEMO", walletConnection: null, updatedAt: now, obligations: [], decisions: [], totalTreasury: { minorUnits: "0" }, liquidUsdc: { minorUnits: "0" }, pendingTransactions: { minorUnits: "0" }, targetAllocationsBps: { LIQUID: 5000, MORPHO: 5000, USYC: 0, BTC_RESERVE: 0 } });
    expect(workspace.policy).toMatchObject({ safetyBuffer: { minorUnits: "1000000" }, minimumLiquidityCoverageBps: 10000, strategyCapsBps: { MORPHO: 6000, USYC: 0, BTC_RESERVE: 0 }, enabledStrategies: { MORPHO: true, USYC: false, BTC_RESERVE: false } });
    expect(workspace.strategies.every((item) => item.balance.minorUnits === "0" && item.redeemable.minorUnits === "0" && item.apyBps === null && item.integration !== "DEMO")).toBe(true);
    expect(workspace.strategies.filter((item) => ["USYC", "BTC_RESERVE"].includes(item.kind)).every((item) => item.name.includes("Not available on Arc Testnet"))).toBe(true);
    expect(workspace.activities.map((item) => item.action)).toEqual(["Workspace created"]);
    const assessment = assessTreasury(workspace, new Date(now));
    expect(previewAllocation(workspace, assessment).violations.some((item) => item.code === "STRATEGY_DISABLED")).toBe(false);
  });
  it("makes independent starter objects", () => {
    const first = createLiveStarterWorkspace(now); first.policy.enabledStrategies.MORPHO = false;
    expect(createLiveStarterWorkspace(now).policy.enabledStrategies.MORPHO).toBe(true);
  });
});
