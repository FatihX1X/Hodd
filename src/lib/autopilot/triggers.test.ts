import { describe, expect, it } from "vitest";
import { AUTOPILOT_INTERVAL_MS, scheduledTrigger } from "./triggers";
import { sampleWorkspace } from "@/test/fixtures";
import type { TreasuryWorkspace } from "@/lib/treasury/models";

const HOUR = 3_600_000, DAY = 86_400_000;
const now = new Date("2026-10-13T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const workspace = (bills: { dueAt: string; status?: "UPCOMING" | "OVERDUE" | "PAID" | "DRAFT" }[] = []): TreasuryWorkspace => ({
  ...structuredClone(sampleWorkspace),
  policy: { ...sampleWorkspace.policy, protectionLeadDays: null },
  obligations: bills.map((bill, index) => ({ ...sampleWorkspace.obligations[0], id: `bill-${index}`, dueAt: bill.dueAt, status: bill.status ?? "UPCOMING" })),
});

describe("scheduledTrigger", () => {
  it("runs the first time, then every six hours", () => {
    const w = workspace();
    expect(scheduledTrigger({ now, lastRunAt: null, lastPolicy: null, workspace: w })).toBe("FIRST_RUN");
    expect(scheduledTrigger({ now, lastRunAt: ago(AUTOPILOT_INTERVAL_MS - 60_000), lastPolicy: w.policy, workspace: w })).toBeNull();
    expect(scheduledTrigger({ now, lastRunAt: ago(AUTOPILOT_INTERVAL_MS), lastPolicy: w.policy, workspace: w })).toBe("SCHEDULE");
  });

  it("reacts to a changed policy, but not to the same policy with keys in another order", () => {
    const w = workspace();
    const reordered = Object.fromEntries(Object.entries(w.policy).reverse()) as typeof w.policy;
    expect(scheduledTrigger({ now, lastRunAt: ago(HOUR), lastPolicy: reordered, workspace: w })).toBeNull();
    expect(scheduledTrigger({ now, lastRunAt: ago(HOUR), lastPolicy: { ...w.policy, minimumLiquidityCoverageBps: w.policy.minimumLiquidityCoverageBps + 500 }, workspace: w })).toBe("POLICY_CHANGED");
  });

  it("reacts when a bill falls due or enters its protection window since the last run", () => {
    // Autopilot protects bills 3 days ahead by default.
    const due = workspace([{ dueAt: ago(30 * 60_000).toISOString() }]);
    expect(scheduledTrigger({ now, lastRunAt: ago(HOUR), lastPolicy: due.policy, workspace: due })).toBe("BILL_DUE");
    const entering = workspace([{ dueAt: new Date(now.getTime() + 3 * DAY - 20 * 60_000).toISOString() }]);
    expect(scheduledTrigger({ now, lastRunAt: ago(HOUR), lastPolicy: entering.policy, workspace: entering })).toBe("BILL_PROTECTION");
    // Already inside the window at the last run: nothing new happened.
    const inside = workspace([{ dueAt: new Date(now.getTime() + DAY).toISOString() }]);
    expect(scheduledTrigger({ now, lastRunAt: ago(HOUR), lastPolicy: inside.policy, workspace: inside })).toBeNull();
  });

  it("ignores paid and draft bills, and never runs twice within five minutes", () => {
    const paid = workspace([{ dueAt: ago(10 * 60_000).toISOString(), status: "PAID" }, { dueAt: ago(10 * 60_000).toISOString(), status: "DRAFT" }]);
    expect(scheduledTrigger({ now, lastRunAt: ago(HOUR), lastPolicy: paid.policy, workspace: paid })).toBeNull();
    const due = workspace([{ dueAt: ago(60_000).toISOString() }]);
    expect(scheduledTrigger({ now, lastRunAt: ago(2 * 60_000), lastPolicy: { ...due.policy, minimumLiquidityCoverageBps: 1 }, workspace: due })).toBeNull();
  });
});
