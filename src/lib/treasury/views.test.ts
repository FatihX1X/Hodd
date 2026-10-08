import { describe, expect, it } from "vitest";
import { assessPayment, assessTreasury } from "./engine";
import { initialWorkspace, usdc } from "./fixtures";
import { allocationByLiquidity, capUsage, liquidityRamp, policyChecks, policySentences, runwayProjection, usdcNumber, weeklyOutflows } from "./views";

const clone = () => structuredClone(initialWorkspace);
const at = new Date("2026-09-27T00:00:00.000Z");

describe("runway projection", () => {
  it("subtracts each protected obligation on its due day and ignores drafts", () => {
    const series = runwayProjection(clone(), at);
    expect(series.points).toHaveLength(31);
    expect(series.points[0].value).toBe(10_000);
    expect(series.points.find((point) => point.day === 6)?.value).toBe(10_000);
    expect(series.points.find((point) => point.day === 7)?.value).toBe(6_000); // Oct 4 payroll (4,000)
    expect(series.points.find((point) => point.day === 11)?.value).toBe(5_500); // Oct 8 AWS (500)
    expect(series.points[30].value).toBe(5_500); // the Oct 12 invoice is a draft and stays excluded
    expect(series.buffer).toBe(1_000);
    expect(series.firstBelowBufferDay).toBeNull();
    expect(series.firstBelowZeroDay).toBeNull();
  });

  it("places overdue obligations on day zero and flags a shortfall", () => {
    const workspace = clone();
    workspace.obligations = [{ ...workspace.obligations[0], id: "late", dueAt: "2026-09-20T00:00:00.000Z", status: "OVERDUE", amount: usdc("12000000000") }];
    const series = runwayProjection(workspace, at);
    expect(series.points[0].due.map((item) => item.id)).toEqual(["late"]);
    expect(series.points[0].value).toBe(-2_000);
    expect(series.firstBelowZeroDay).toBe(0);
    expect(series.firstBelowBufferDay).toBe(0);
  });
});

describe("weekly outflows", () => {
  it("groups protected obligations by Monday-start week and skips drafts and paid records", () => {
    const weeks = weeklyOutflows(initialWorkspace.obligations, at, 4);
    expect(weeks).toHaveLength(4);
    expect(new Date(weeks[0].start).toISOString()).toBe("2026-09-21T00:00:00.000Z");
    expect(weeks.map((week) => week.total)).toEqual([0, 4_000, 500, 0]);
    expect(weeks[1].titles).toEqual(["October payroll"]);
  });

  it("puts overdue records in the first week and drops anything past the window", () => {
    const base = initialWorkspace.obligations[0];
    const weeks = weeklyOutflows([{ ...base, id: "late", dueAt: "2026-08-01T00:00:00.000Z", status: "OVERDUE" }, { ...base, id: "far", dueAt: "2027-01-01T00:00:00.000Z" }], at, 3);
    expect(weeks.map((week) => week.count)).toEqual([1, 0, 0]);
  });
});

describe("allocation by liquidity", () => {
  it("orders held strategies from most to least liquid and assigns the ordinal ramp", () => {
    const workspace = clone();
    workspace.strategies = workspace.strategies.map((strategy) => strategy.kind === "LIQUID" ? { ...strategy, balance: usdc("6000000000") } : strategy.kind === "MORPHO" ? { ...strategy, balance: usdc("3000000000"), redeemable: usdc("3000000000") } : strategy.kind === "USYC" ? { ...strategy, balance: usdc("1000000000") } : strategy);
    const rows = allocationByLiquidity(workspace.strategies);
    expect(rows.map((row) => row.kind)).toEqual(["LIQUID", "MORPHO", "USYC"]);
    expect(rows.map((row) => Math.round(row.share * 100))).toEqual([60, 30, 10]);
    expect(rows.map((row) => row.color)).toEqual([...liquidityRamp].slice(0, 3));
  });

  it("is empty when nothing is held", () => {
    const strategies = clone().strategies.map((strategy) => ({ ...strategy, balance: usdc("0") }));
    expect(allocationByLiquidity(strategies)).toEqual([]);
  });
});

describe("policy views", () => {
  it("measures a position against its cap as a share of total treasury", () => {
    const workspace = clone();
    const morpho = { ...workspace.strategies[1], balance: usdc("3000000000") };
    const usage = capUsage(workspace, morpho);
    expect(usage.capBps).toBe(6000);
    expect(usage.capAmount).toBe(6_000);
    expect(usage.ratio).toBeCloseTo(0.5);
    expect(capUsage(workspace, workspace.strategies[2]).ratio).toBeNull(); // USYC cap is 0
  });

  it("describes the policy in plain language, including disabled strategies", () => {
    const lines = policySentences(initialWorkspace.policy);
    expect(lines[0]).toContain("1,000.00 USDC safety buffer");
    expect(lines).toContain("Place at most 60% in Morpho.");
    expect(lines).toContain("USYC is not enabled; capital stays liquid.");
    expect(lines.at(-1)).toContain("approved by your own wallet");
  });

  it("passes a healthy workspace and flags an under-covered one", () => {
    const healthy = policyChecks(initialWorkspace, assessTreasury(initialWorkspace, at));
    expect(healthy.every((check) => check.status === "PASS")).toBe(true);
    const stressed = clone();
    stressed.policy.safetyBuffer = usdc("20000000000");
    const result = policyChecks(stressed, assessTreasury(stressed, at));
    expect(result.some((check) => check.status === "ATTENTION")).toBe(true);
    expect(result.some((check) => check.title === "LIQUIDITY SHORTFALL")).toBe(true);
  });
});

describe("assessPayment", () => {
  it("returns the funding plan for a protected obligation and null for others", () => {
    const plan = assessPayment(initialWorkspace, "obl-aws-oct", at);
    expect(plan?.status).toBe("SAFE");
    expect(plan?.steps[0].source).toBe("LIQUID_USDC");
    expect(assessPayment(initialWorkspace, "obl-invoice-104", at)).toBeNull(); // draft
    expect(assessPayment(initialWorkspace, "missing", at)).toBeNull();
  });

  it("converts minor units for display only", () => {
    expect(usdcNumber(usdc("4500000000"))).toBe(4500);
  });
});
