import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "@/test/fixtures";
import type { TreasuryWorkspace } from "@/lib/treasury/models";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ live: vi.fn(), cookie: "" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: mocks.cookie }) }) }));
vi.mock("@/lib/agent/context", () => ({ liveWorkspace: mocks.live }));
vi.mock("@/lib/agent/tools", () => ({ estimateTransferFee: async () => ({ currency: "USDC", decimals: 6, minorUnits: "1000" }) }));
import { confirmChange, prepareChange, resolveIntent, resolveSelection } from "./service";
import { newConsent, requireConsent, type HoddieContext } from "./security";
import { maskCommand } from "./privacy";
import { intentSchema, type HoddieIntent } from "./models";
const baseIntent: HoddieIntent = { action: "OVERVIEW", language: "en", obligationToken: null, amountToken: null, titleToken: null, dateToken: null, addressToken: null, dateMode: "NONE", useCurrentSelection: false, status: null, policyField: null, strategy: null, enabled: null, percentToken: null, targets: [], operation: null, route: null };
const intent = (patch: Partial<HoddieIntent>) => intentSchema.parse({ ...baseIntent, ...patch });
const context = (): HoddieContext => ({ userId: "owner", sessionId: "session", revision: 3, wallet: "digest", workspace: structuredClone(initialWorkspace), client: { rpc: vi.fn().mockResolvedValue({ data: 4, error: null }) } as unknown as HoddieContext["client"] });
const consentFor = async (owner: HoddieContext) => { mocks.cookie = newConsent(owner, "GEMINI"); return requireConsent(owner, "GEMINI"); };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-08T10:00:00Z")); vi.stubEnv("HODD_MCP_HANDLE_SECRET", "hoddie-unit-test-key-never-a-real-secret"); vi.clearAllMocks();
  mocks.live.mockImplementation(async (workspace: TreasuryWorkspace) => ({ workspace, source: "NOT_CONNECTED", note: "No wallet", snapshot: null, portfolio: null }));
});
afterEach(() => vi.useRealTimers());
describe("Hoddie deterministic treasury results and explicit application", () => {
  it("produces exact canonical summary values without a provider", async () => {
    const owner = context(); const result = await resolveIntent(owner, await consentFor(owner), intent({}), maskCommand("Hesabımı özetle", owner.workspace), "UTC");
    expect(result.source).toBe("NOT_CONNECTED");
    expect(result.cards[0].fields).toContainEqual({ label: "Total treasury", value: "10000 USDC" });
    expect(result.cards[0].fields).toContainEqual({ label: "Deployable capital", value: "4500 USDC" });
    expect(owner.client.rpc).not.toHaveBeenCalled();
  });
  it("previews a 2000 USDC obligation without writing, then applies stable exact values once", async () => {
    const owner = context(); const consent = await consentFor(owner);
    const raw = { title: "New invoice", amount: "2000", dueDate: "2026-10-20" };
    const result = await prepareChange(owner, consent, "CREATE_OBLIGATION", raw);
    expect(result.proposal?.impact).toContainEqual({ label: "Deployable capital", before: "4500 USDC", after: "2500 USDC" });
    expect(owner.workspace.obligations).toHaveLength(3); expect(owner.client.rpc).not.toHaveBeenCalled();
    await confirmChange(owner, consent, result.proposal!.handle);
    const input = vi.mocked(owner.client.rpc).mock.calls[0][1] as { p_workspace: TreasuryWorkspace; p_revision: number };
    expect(input.p_workspace.obligations.at(-1)?.amount.minorUnits).toBe("2000000000");
    expect(input.p_workspace.activities[0].action).toBe("Obligation created via Hoddie");
    expect(input.p_workspace.activities[0].reason).toContain("Apply change"); expect(input.p_revision).toBe(3);
    vi.mocked(owner.client.rpc).mockResolvedValueOnce({ error: { message: "duplicate id" } } as never);
    await expect(confirmChange(owner, consent, result.proposal!.handle)).rejects.toMatchObject({ code: "CONFIRMATION_CONFLICT" });
  });
  it("rejects revision drift, cross-user, expiry and changed payload before writing", async () => {
    const owner = context(); const consent = await consentFor(owner); const result = await prepareChange(owner, consent, "UPDATE_POLICY", { safetyBuffer: "1.000001" });
    for (const patch of [{ revision: 4 }, { userId: "other" }, { wallet: "other" }]) await expect(confirmChange({ ...owner, ...patch }, consent, result.proposal!.handle)).rejects.toThrow();
    await expect(confirmChange(owner, consent, `${result.proposal!.handle}x`)).rejects.toThrow();
    vi.advanceTimersByTime(600000); await expect(confirmChange(owner, consent, result.proposal!.handle)).rejects.toThrow();
    expect(owner.client.rpc).not.toHaveBeenCalled();
  });
  it("parallel confirmation uses the same atomic action ID and only one succeeds", async () => {
    const owner = context(); const consent = await consentFor(owner);
    const result = await prepareChange(owner, consent, "UPDATE_POLICY", { safetyBuffer: "2" });
    let claimed = false;
    vi.mocked(owner.client.rpc).mockImplementation((async () => {
      if (claimed) return { error: { message: "revision/unique conflict" } } as never;
      claimed = true; return { data: 4, error: null } as never;
    }) as never);
    const results = await Promise.allSettled([confirmChange(owner, consent, result.proposal!.handle), confirmChange(owner, consent, result.proposal!.handle)]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    const calls = vi.mocked(owner.client.rpc).mock.calls;
    expect((calls[0][1] as { p_id: string }).p_id).toBe((calls[1][1] as { p_id: string }).p_id);
  });
  it("asks for missing fields and duplicate obligation selection instead of guessing", async () => {
    const owner = context(); owner.workspace.obligations.push({ ...owner.workspace.obligations[0], id: "second-payroll" });
    const consent = await consentFor(owner);
    const draft = await resolveIntent(owner, consent, intent({ action: "CREATE_OBLIGATION", amountToken: "[AMOUNT1]" }), maskCommand("Create 10 USDC", owner.workspace), "UTC");
    expect(draft.draft?.values).toEqual({ amount: "10" }); expect(draft.proposal).toBeUndefined();
    const command = maskCommand("Change October payroll to 20 USDC", owner.workspace);
    const choices = await resolveIntent(owner, consent, intent({ action: "UPDATE_OBLIGATION", obligationToken: "[OBLIGATION1]", amountToken: "[AMOUNT2]" }), command, "UTC");
    expect(choices.choices).toHaveLength(2);
    const selected = await resolveSelection(owner, consent, choices.choices![1].handle);
    expect(selected.proposal?.summary).toContain("20.00 USDC"); expect(owner.client.rpc).not.toHaveBeenCalled();
  });
  it("never fabricates PAID status, amount tokens, dates or duplicate allocation targets", async () => {
    const owner = context(); const consent = await consentFor(owner); const command = maskCommand("Update October payroll to 10 USDC", owner.workspace);
    await expect(resolveIntent(owner, consent, intent({ action: "UPDATE_OBLIGATION", status: "PAID", obligationToken: "[OBLIGATION1]", amountToken: "[AMOUNT2]" }), command, "UTC")).rejects.toMatchObject({ code: "PAID_RECEIPT_REQUIRED" });
    await expect(resolveIntent(owner, consent, intent({ action: "CREATE_OBLIGATION", amountToken: "[AMOUNT999]" }), command, "UTC")).rejects.toThrow();
    await expect(resolveIntent(owner, consent, intent({ action: "CREATE_OBLIGATION", dateMode: "TOMORROW" }), command, "UTC")).rejects.toMatchObject({ code: "DATE_REQUIRED" });
    await expect(resolveIntent(owner, consent, intent({ action: "SET_TARGETS", targets: [{ strategy: "LIQUID", percentToken: "[PERCENT1]" }, { strategy: "LIQUID", percentToken: "[PERCENT1]" }] }), command, "UTC")).rejects.toThrow();
  });
  it("blocks money requests without complete live data and never creates a quote", async () => {
    const owner = context(); const consent = await consentFor(owner);
    await expect(prepareChange(owner, consent, "EARN_REQUEST", { operation: "DEPOSIT", amount: "1" })).rejects.toMatchObject({ code: "LIVE_DATA_REQUIRED" });
    mocks.live.mockImplementation(async (workspace: TreasuryWorkspace) => ({ workspace, source: "PARTIAL", note: "Positions unavailable" }));
    for (const action of ["ALLOCATION", "CHECK_PAYMENT"] as const) await expect(resolveIntent(owner, consent, intent({ action, obligationToken: action === "CHECK_PAYMENT" ? "[OBLIGATION1]" : null }), maskCommand("October payroll", owner.workspace), "UTC")).rejects.toMatchObject({ code: "LIVE_DATA_REQUIRED" });
    expect(owner.client.rpc).not.toHaveBeenCalled();
  });
  it("derives overdue status for reads without mutating the saved obligation", async () => {
    const owner = context(); const result = await resolveIntent(owner, await consentFor(owner), intent({ action: "OBLIGATIONS", status: "OVERDUE" }), maskCommand("Overdue bills", owner.workspace), "UTC");
    expect(result.cards).toHaveLength(1); expect(result.cards[0].fields).toContainEqual({ label: "status", value: "OVERDUE" });
    expect(owner.workspace.obligations[0].status).toBe("UPCOMING");
  });
  it("blocks deposit policy excess and selected-vault withdrawal liquidity excess", async () => {
    const owner = context(); const consent = await consentFor(owner); const vaultAddress = `0x${"1".repeat(40)}`;
    const money = (minorUnits: string) => ({ currency: "USDC", decimals: 6, minorUnits });
    mocks.live.mockImplementation(async (workspace: TreasuryWorkspace) => ({ workspace, source: "LIVE", portfolio: { vaults: [{ address: vaultAddress, liquidity: money("500000") }], positions: [{ vaultAddress, currentBalance: money("2000000"), redeemable: money("1000000"), maxWithdrawable: money("1000000"), liquidityStatus: "READY", observedAt: new Date().toISOString() }] } }));
    await expect(prepareChange(owner, consent, "EARN_REQUEST", { operation: "DEPOSIT", amount: "10000", vaultAddress })).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    await expect(prepareChange(owner, consent, "EARN_REQUEST", { operation: "WITHDRAW", amount: "1", vaultAddress })).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    await expect(prepareChange(owner, consent, "EARN_REQUEST", { operation: "WITHDRAW", amount: "0.5", vaultAddress: `0x${"2".repeat(40)}` })).rejects.toMatchObject({ code: "VAULT_REQUIRED" });
    expect(owner.client.rpc).not.toHaveBeenCalled();
  });
  it("validates real dates, precision and policy caps using existing shared rules", async () => {
    const owner = context(); const consent = await consentFor(owner);
    await expect(prepareChange(owner, consent, "CREATE_OBLIGATION", { title: "x", amount: "1", dueDate: "2026-02-30" })).rejects.toMatchObject({ code: "INVALID_DATE" });
    expect((await prepareChange(owner, consent, "CREATE_OBLIGATION", { title: "x", amount: "1.1234567", dueDate: "2026-10-20" })).draft).toBeDefined();
    expect((await prepareChange(owner, consent, "UPDATE_POLICY", { strategyCapsBps: { MORPHO: 10001 } })).draft).toBeDefined();
    await expect(prepareChange(owner, consent, "SET_TARGETS", { targetsBps: { LIQUID: 2000, MORPHO: 1000, USYC: 0, BTC_RESERVE: 0 } })).rejects.toThrow("total 10000");
    expect(owner.client.rpc).not.toHaveBeenCalled();
  });
});
