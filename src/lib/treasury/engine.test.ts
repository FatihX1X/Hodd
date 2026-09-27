import { describe, expect, it } from "vitest";
import { assessTreasury, buildWaterfall, getProtectedObligations, previewAllocation } from "./engine";
import { initialWorkspace, usdc } from "./fixtures";

const clone = () => structuredClone(initialWorkspace);
describe("Treasury Engine", () => {
  it("includes overdue and 30-day obligations but excludes draft, paid and later records", () => { const workspace = clone(); workspace.obligations = [
    { ...workspace.obligations[0], id: "overdue", dueAt: "2026-09-20T00:00:00.000Z", status: "UPCOMING" }, { ...workspace.obligations[0], id: "boundary", dueAt: "2026-10-27T00:00:00.000Z", status: "UPCOMING" },
    { ...workspace.obligations[0], id: "later", dueAt: "2026-10-28T00:00:00.000Z", status: "UPCOMING" }, { ...workspace.obligations[0], id: "draft", dueAt: "2026-10-01T00:00:00.000Z", status: "DRAFT" }, { ...workspace.obligations[0], id: "paid", dueAt: "2026-10-01T00:00:00.000Z", status: "PAID" },
  ]; expect(getProtectedObligations(workspace, new Date("2026-09-27T00:00:00.000Z")).map((item) => item.id)).toEqual(["overdue", "boundary"]); });
  it("clamps deployable capital to zero and reports a shortfall", () => { const workspace = clone(); workspace.policy.safetyBuffer = usdc("20000000000"); const result = assessTreasury(workspace, new Date("2026-09-27T00:00:00.000Z")); expect(result.deployableCapital.minorUnits).toBe("0"); expect(result.violations.some((item) => item.code === "LIQUIDITY_SHORTFALL")).toBe(true); });
  it("uses a dedicated no-obligations coverage state", () => { const workspace = clone(); workspace.obligations = []; const result = assessTreasury(workspace); expect(result.liquidityCoverageBps).toBeNull(); expect(result.coverageStatus).toBe("NO_OBLIGATIONS"); });
  it("uses the waterfall in order and reports an unresolved remainder", () => { const result = buildWaterfall(usdc("3000000000"), [{ source: "LIQUID_USDC", available: usdc("800000000") }, { source: "MORPHO", available: usdc("1200000000") }]); expect(result.steps.map((item) => item.source)).toEqual(["LIQUID_USDC", "MORPHO"]); expect(result.shortfall.minorUnits).toBe("1000000000"); });
  it("keeps disabled and capped allocation amounts liquid", () => { const workspace = clone(); workspace.policy.strategyCapsBps.MORPHO = 3000; const plan = previewAllocation(workspace, assessTreasury(workspace, new Date("2026-09-27T00:00:00.000Z"))); expect(plan.lines.find((item) => item.strategy === "MORPHO")?.approved.minorUnits).toBe("1350000000"); expect(plan.unallocatedToLiquid.minorUnits).toBe("3150000000"); expect(plan.status).toBe("REVIEW"); });
});

