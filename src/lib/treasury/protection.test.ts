import { describe, expect, it } from "vitest";
import { initialWorkspace, usdc } from "@/test/fixtures";
import { treasuryWorkspaceSchema, treasuryPolicySchema } from "./models";
import { assessPayment, assessTreasury, effectiveProtectionLeadDays, protectionPlan } from "./engine";
import { runwayProjection } from "./views";
import { LocalTreasuryRepository, WORKSPACE_STORAGE_KEY, migrateLegacyWorkspace, migrateStage3Workspace, migrateStage4Workspace } from "./repository";
const now = new Date("2026-10-10T12:00:00.000Z");
const day = (days: number) => new Date(now.getTime() + days * 86400000).toISOString();
function workspace() {
  const w = structuredClone(initialWorkspace);
  w.policy.safetyBuffer = usdc("100"); w.pendingTransactions = usdc("0");
  w.totalTreasury = usdc("1000"); w.liquidUsdc = usdc("500");
  w.strategies = [{ ...w.strategies[1], balance: usdc("500"), redeemable: usdc("500"), integration: "LIVE", observedAt: now.toISOString(), liquidityStatus: "READY" }];
  w.obligations = [{ ...w.obligations[0], id: "bill", amount: usdc("200"), dueAt: day(5), status: "UPCOMING" }];
  return w;
}
const bill = (id: string, days: number, amount: string) => ({ ...workspace().obligations[0], id, dueAt: day(days), amount: usdc(amount) });
describe("policy migration", () => {
  const old = () => { const w = workspace(); const { planningHorizonDays: _planning, protectionLeadDays: _lead, ...policy } = w.policy; void _planning; void _lead; return { ...w, policy: { ...policy, obligationHorizonDays: 30 } }; };
  it("reads old JSON losslessly and never serializes the old key", () => {
    const input = old(); const parsed = treasuryWorkspaceSchema.parse(input);
    expect(parsed).toEqual({ ...workspace(), policy: { ...workspace().policy, planningHorizonDays: 30, protectionLeadDays: null } });
    expect(input.policy).toHaveProperty("obligationHorizonDays", 30);
    const values = new Map([[WORKSPACE_STORAGE_KEY, JSON.stringify(input)]]);
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    const repository = new LocalTreasuryRepository(storage); const loaded = repository.load();
    expect(loaded.status).toBe("READY"); expect(loaded.workspace.policy.protectionLeadDays).toBeNull();
    repository.save(loaded.workspace); expect(values.get(WORKSPACE_STORAGE_KEY)).not.toContain("obligationHorizonDays");
    for (const [version, migrate] of [[1, migrateLegacyWorkspace], [2, migrateStage3Workspace], [3, migrateStage4Workspace]] as const) {
      expect(migrate({ ...input, schemaVersion: version, walletConnection: null })?.policy).toEqual(parsed.policy);
    }
  });
  it.each([2, 31, 3.5])("rejects invalid protection lead %s", (protectionLeadDays) => {
    expect(treasuryPolicySchema.safeParse({ ...workspace().policy, protectionLeadDays }).success).toBe(false);
  });
  it("does not silently repair invalid new fields using a legacy key", () => {
    expect(treasuryPolicySchema.safeParse({ ...old().policy, planningHorizonDays: 30, protectionLeadDays: 2 }).success).toBe(false);
    expect(treasuryPolicySchema.safeParse({ ...old().policy, obligationHorizonDays: 29 }).success).toBe(false);
  });
});
describe("protection lead and planning", () => {
  it.each([
    [false, null, 7, "LEAD_TIME"], [true, null, 3, null], [false, 10, 10, "LEAD_TIME"], [true, 10, 10, "LEAD_TIME"],
  ] as const)("mode %s / choice %s resolves to %s", (autopilotActive, choice, expected, reason) => {
    const w = workspace(); w.policy.protectionLeadDays = choice; const context = { autopilotActive };
    expect(effectiveProtectionLeadDays(w.policy, context)).toBe(expected);
    const plan = protectionPlan(w, now, context);
    expect(plan.protected.map((item) => item.reason)).toEqual(reason ? [reason] : []);
    expect(plan.planned.map((item) => item.id)).toEqual(reason ? [] : ["bill"]);
    const result = assessTreasury(w, now, context); expect(result.protectionLeadDays).toBe(expected);
    expect(result.plannedObligations.minorUnits).toBe(reason ? "0" : "200");
    expect(assessPayment(w, "bill", now, context)?.status ?? null).toBe(reason ? "SAFE" : null);
  });
  it("protects the exact lead boundary and overdue records regardless of mode", () => {
    const w = workspace(); w.obligations = [bill("lead", 3, "1"), bill("late", -1, "1"), { ...bill("flag", 40, "1"), status: "OVERDUE" }, bill("outside", 31, "1"), { ...bill("draft", 1, "1"), status: "DRAFT" }, { ...bill("paid", 1, "1"), status: "PAID" }];
    expect(protectionPlan(w, now, { autopilotActive: true }).protected.map(({ obligation, reason }) => [obligation.id, reason])).toEqual([["late", "OVERDUE"], ["lead", "LEAD_TIME"], ["flag", "OVERDUE"]]);
  });
  it.each(["missing", "stale", "unavailable", "missing-status", "future", "disconnected"])("fails closed with %s vault data", (failure) => {
    const w = workspace(); w.obligations = [bill("a", 5, "100"), bill("b", 30, "100")];
    if (failure === "missing") delete w.strategies[0].observedAt;
    if (failure === "stale") w.strategies[0].observedAt = new Date(now.getTime() - 900001).toISOString();
    if (failure === "unavailable") w.strategies[0].liquidityStatus = "UNAVAILABLE";
    if (failure === "missing-status") delete w.strategies[0].liquidityStatus;
    if (failure === "future") w.strategies[0].observedAt = day(1);
    if (failure === "disconnected") w.strategies[0].integration = "UNAVAILABLE";
    const plan = protectionPlan(w, now, { autopilotActive: true });
    expect(plan.planned).toEqual([]); expect(plan.protected.map((item) => item.reason)).toEqual(["STALE_DATA", "STALE_DATA"]);
    expect(assessTreasury(w, now).safelyAvailableLiquidity).toEqual(w.liquidUsdc);
  });
  it("accepts an observation exactly 15 minutes old", () => {
    const w = workspace(); w.strategies[0].observedAt = new Date(now.getTime() - 900000).toISOString();
    expect(protectionPlan(w, now, { autopilotActive: true }).planned).toHaveLength(1);
  });
  it("reserves near bills, buffer and pending in waterfall order, then protects every bill beyond the cumulative vault limit", () => {
    const w = workspace(); w.liquidUsdc = usdc("100"); w.pendingTransactions = usdc("50");
    w.obligations = [bill("near", 2, "100"), bill("c", 7, "1"), bill("b", 5, "151"), bill("a", 5, "200"), bill("boundary", 30, "1")];
    // 250 reserved; 100 from liquid and 150 from Morpho leaves 350 redeemable.
    const plan = protectionPlan(w, now, { autopilotActive: true });
    expect(plan.planned.map((item) => item.id)).toEqual(["a"]);
    expect(plan.protected.map(({ obligation, reason }) => [obligation.id, reason])).toEqual([["near", "LEAD_TIME"], ["b", "LOW_VAULT_LIQUIDITY"], ["c", "LOW_VAULT_LIQUIDITY"], ["boundary", "LOW_VAULT_LIQUIDITY"]]);
    w.obligations.find((item) => item.id === "b")!.amount = usdc("150");
    expect(protectionPlan(w, now, { autopilotActive: true }).planned.map((item) => item.id)).toEqual(["a", "b"]);
  });
  it("aggregates multiple vaults and excludes liquid cash from later-funding capacity", () => {
    const w = workspace(); w.strategies[0].redeemable = usdc("100"); w.strategies.push({ ...w.strategies[0], id: "second" });
    expect(protectionPlan(w, now, { autopilotActive: true }).planned).toHaveLength(1);
    w.strategies.pop(); expect(protectionPlan(w, now, { autopilotActive: true }).protected[0].reason).toBe("LOW_VAULT_LIQUIDITY");
  });
  it("changes deployable and coverage while keeping the runway over all planned bills", () => {
    const w = workspace(); w.obligations.push(bill("near", 2, "100"));
    const manual = assessTreasury(w, now); const active = assessTreasury(w, now, { autopilotActive: true });
    expect(manual.upcomingObligations.minorUnits).toBe("300"); expect(active.upcomingObligations.minorUnits).toBe("100");
    expect(manual.deployableCapital.minorUnits).toBe("600"); expect(active.deployableCapital.minorUnits).toBe("800");
    expect(manual.liquidityCoverageBps).toBe(33333); expect(active.liquidityCoverageBps).toBe(100000);
    expect(runwayProjection(w, now).points.at(-1)?.value).toBe(0.0007);
  });
  it("excludes payment reservations from both lists without losing pending reserves", () => {
    const w = workspace(); w.paymentReservations = [{ proposalId: "00000000-0000-4000-8000-000000000001", obligationId: "bill", amount: usdc("200"), feeReserve: usdc("10") }]; w.pendingTransactions = usdc("210");
    expect(protectionPlan(w, now).protected).toEqual([]); expect(protectionPlan(w, now).planned).toEqual([]);
    expect(assessTreasury(w, now).protectedCapital.minorUnits).toBe("310");
  });
});

describe("protection before anything is invested", () => {
  it("calls an empty Morpho position low vault liquidity, not stale data, and a failed read stale", async () => {
    const { applyEarnPortfolio } = await import("./live");
    const w = workspace(); w.strategies = [{ ...w.strategies[0], balance: usdc("0"), redeemable: usdc("0"), observedAt: undefined, liquidityStatus: undefined }];
    w.obligations = [bill("later", 20, "200")];
    const read = applyEarnPortfolio(w, { vaults: [], positions: [], integration: { positionAccess: "READY" }, observedAt: now.toISOString() });
    expect(read.strategies[0]).toMatchObject({ observedAt: now.toISOString(), liquidityStatus: "READY" });
    expect(protectionPlan(read, now).protected).toEqual([{ obligation: expect.objectContaining({ id: "later" }), reason: "LOW_VAULT_LIQUIDITY" }]);
    // Without a successful read Hodd cannot know the vault, so the same bill is protected as stale data.
    expect(protectionPlan(w, now).protected[0].reason).toBe("STALE_DATA");
    // No vault entry at all is not stale either.
    expect(protectionPlan({ ...w, strategies: [] }, now).protected[0].reason).toBe("LOW_VAULT_LIQUIDITY");
  });
});
