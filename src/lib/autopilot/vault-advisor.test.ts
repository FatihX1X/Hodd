// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { sampleWorkspace } from "@/test/fixtures";
import type { EarnPosition } from "@/lib/earn/models";
import { decideVault, routeOf, NOTHING_TO_INVEST, type VaultDecisionInputs } from "./vault-decision";
import { VAULT_LIMITS, VAULT_MORPHO } from "./vault";
import { adviseVaultDecision, applyVaultAdvice, vaultAdviceSchema, vaultAdvisorEnvelope, vaultAdvisorFacts, vaultAdvisorPrompt, type VaultAdvice } from "./vault-advisor";
import type { VaultUsyc } from "./vault-state";

const now = new Date("2026-10-14T12:00:00.000Z");
const USDC = 1_000_000n;
const source = { provider: "GROQ", model: "openai/gpt-oss-120b" };
const usdc = (minor: bigint) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits: minor.toString() });
const position = (balance: bigint): EarnPosition => ({ walletAddress: "0x3333333333333333333333333333333333333333", vaultAddress: VAULT_MORPHO, vaultName: "Morpho", currentBalance: usdc(balance), maxWithdrawable: usdc(balance), redeemable: usdc(balance), liquidityStatus: "READY", shares: balance.toString(), apyBps: 500, pnl: { status: "UNAVAILABLE", reason: "No history" }, observedAt: now.toISOString() });
const usyc = (value: bigint, patch: Partial<VaultUsyc> = {}): VaultUsyc => ({ shares: value * 1_000_000n, valueMinor: value, redeemableMinor: value, redeemableShares: value * 1_000_000n, depositRoomMinor: 30n * USDC, ready: true, afterHoursPricing: false, observedAt: now.toISOString(), ...patch });
function inputs(patch: Partial<VaultDecisionInputs> = {}): VaultDecisionInputs {
  const workspace = structuredClone(sampleWorkspace); workspace.obligations = [];
  return { workspace, ownerPositions: [], vaultPosition: position(20n * USDC), usyc: usyc(10n * USDC), apy: { morphoBps: 500, usycBps: 350 }, mandate: { budgetMinor: "1", reserveMinor: "0", maxPerRunMinor: "1", maxMorphoBps: 0, enabled: true, paused: false }, idleMinor: (50n * USDC).toString(), bills: [], depositRoomMinor: VAULT_LIMITS.maxDepositPerTx, paymentRoomMinor: VAULT_LIMITS.maxPaymentPerTx, agentGasMinor: "1000000", feeReserveMinor: "100000", now, ...patch };
}
const advice = (patch: Partial<VaultAdvice>): VaultAdvice => ({ action: "FOLLOW", morphoUsdc: null, usycUsdc: null, from: null, to: null, amountUsdc: null, rationale: "Morpho yields 5% against 3.5% for USYC.", ...patch });
const setup = (patch: Partial<VaultDecisionInputs> = {}) => { const input = inputs(patch), engine = decideVault(input); return { input, engine, envelope: vaultAdvisorEnvelope(engine, input)! }; };

describe("vault advisor envelope", () => {
  it("offers a split, waiting and moves when the engine invests", () => {
    const { engine, envelope } = setup();
    expect(engine.kind).toBe("INVEST");
    expect(envelope).toMatchObject({ actions: ["FOLLOW", "ALLOCATE", "WAIT", "MOVE"], investMaxMinor: 50n * USDC, usycRoomMinor: 30n * USDC, moveFromMinor: { MORPHO: 20n * USDC, USYC: 10n * USDC } });
  });

  it("offers only moves when there is nothing new to invest, and nothing without a position to move", () => {
    const { engine, envelope } = setup({ idleMinor: "0" });
    expect(engine.explanation).toBe(NOTHING_TO_INVEST);
    expect(envelope.actions).toEqual(["FOLLOW", "MOVE"]);
    const empty = inputs({ idleMinor: "0", vaultPosition: position(0n), usyc: usyc(0n) });
    expect(vaultAdvisorEnvelope(decideVault(empty), empty)).toBeNull();
  });

  it("may invest the whole cash, including what the engine keeps for a bill, and may keep money invested until the payment day", () => {
    const rent = { obligation: { id: "rent", title: "Rent", category: "RENT" as const, amount: usdc(40n * USDC), dueAt: new Date(now.getTime() + 2 * 86_400_000).toISOString(), recipient: "Landlord", priority: "HIGH" as const, status: "UPCOMING" as const, description: "", recipientAddress: "0x4444444444444444444444444444444444444444" }, approved: true, capMinor: 40n * USDC, busy: false };
    const keeping = setup({ bills: [rent] });
    expect(keeping.engine).toMatchObject({ kind: "INVEST", depositMinor: (10n * USDC).toString() });
    expect(keeping.envelope.investMaxMinor).toBe(50n * USDC);
    expect(applyVaultAdvice(keeping.engine, keeping.envelope, advice({ action: "ALLOCATE", morphoUsdc: "30", usycUsdc: "20" }), source)).toMatchObject({ kind: "INVEST", depositMinor: (50n * USDC).toString(), advisor: { status: "APPLIED" } });
    // The engine would bring 30 back to cash for the bill; the advisor may wait instead.
    const raising = setup({ bills: [rent], idleMinor: (10n * USDC).toString() });
    expect(raising.engine.kind).toBe("RESERVE_REFILL");
    expect(raising.envelope.actions).toEqual(["FOLLOW", "ALLOCATE", "WAIT", "MOVE"]);
    expect(applyVaultAdvice(raising.engine, raising.envelope, advice({ action: "WAIT" }), source)).toMatchObject({ kind: "NO_ACTION", withdrawMinor: "0", advisor: { status: "APPLIED" } });
    const facts = vaultAdvisorFacts(raising.input);
    expect(facts.approvedBills).toEqual([{ amountUsdc: "40", daysUntilDue: 2, daysUntilPaymentDay: 1 }]);
  });

  it("never touches bills, top-ups, returns or a paused mandate", () => {
    const due = inputs({ bills: [{ obligation: { id: "rent", title: "Rent", category: "RENT", amount: usdc(5n * USDC), dueAt: new Date(now.getTime() + 3_600_000).toISOString(), recipient: "Landlord", priority: "HIGH", status: "UPCOMING", description: "", recipientAddress: "0x4444444444444444444444444444444444444444" }, approved: true, capMinor: 5n * USDC, busy: false }] });
    expect(decideVault(due).kind).toBe("PAY_BILL");
    expect(vaultAdvisorEnvelope(decideVault(due), due)).toBeNull();
    const returning = inputs({ returnAll: true });
    expect(vaultAdvisorEnvelope(decideVault(returning), returning)).toBeNull();
    const paused = inputs(); paused.mandate = { ...paused.mandate, paused: true };
    expect(vaultAdvisorEnvelope(decideVault(paused), paused)).toBeNull();
  });
});

describe("applying vault advice", () => {
  it("splits new cash between Morpho and USYC, keeping the rest as cash", () => {
    const { engine, envelope } = setup();
    const decision = applyVaultAdvice(engine, envelope, advice({ action: "ALLOCATE", morphoUsdc: "30", usycUsdc: "15.5" }), source);
    expect(decision).toMatchObject({ kind: "INVEST", depositMinor: "45500000", advisor: { status: "APPLIED", action: "ALLOCATE" } });
    expect(routeOf(decision)).toMatchObject({ depositMorphoMinor: "30000000", depositUsycMinor: "15500000" });
    expect(decision.explanation).toMatch(/^Advisor: /);
    // The engine's own split counts as following it.
    expect(applyVaultAdvice(engine, envelope, advice({ action: "ALLOCATE", morphoUsdc: "50", usycUsdc: null }), source).advisor?.status).toBe("FOLLOWED");
  });

  it.each([
    ["more than the free cash", { morphoUsdc: "40", usycUsdc: "11" }],
    ["more than USYC accepts", { morphoUsdc: "0", usycUsdc: "31" }],
    ["a part below 1 USDC", { morphoUsdc: "0.5", usycUsdc: "10" }],
    ["nothing at all", { morphoUsdc: "0", usycUsdc: "0" }],
    ["not a number", { morphoUsdc: "all", usycUsdc: "1" }],
  ])("rejects a split with %s and keeps the engine's decision", (_, split) => {
    const { engine, envelope } = setup();
    const decision = applyVaultAdvice(engine, envelope, advice({ action: "ALLOCATE", ...split }), source);
    expect(decision).toMatchObject({ kind: engine.kind, depositMinor: engine.depositMinor, advisor: { status: "REJECTED" } });
  });

  it("moves between the strategies or back to cash within what each can pay out and take", () => {
    const { engine, envelope } = setup({ idleMinor: "0" });
    const rebalance = applyVaultAdvice(engine, envelope, advice({ action: "MOVE", from: "MORPHO", to: "USYC", amountUsdc: "12" }), source);
    expect(rebalance).toMatchObject({ kind: "REBALANCE", withdrawMinor: "12000000", depositMinor: "12000000", advisor: { status: "APPLIED", action: "MOVE" } });
    expect(routeOf(rebalance)).toEqual({ withdrawMorphoMinor: "12000000", withdrawUsycMinor: "0", depositMorphoMinor: "0", depositUsycMinor: "12000000" });
    const toCash = applyVaultAdvice(engine, envelope, advice({ action: "MOVE", from: "USYC", to: "CASH", amountUsdc: "4" }), source);
    expect(toCash).toMatchObject({ kind: "DE_RISK", withdrawMinor: "4000000", depositMinor: "0" });
    expect(routeOf(toCash)).toMatchObject({ withdrawUsycMinor: "4000000" });
    for (const bad of [advice({ action: "MOVE", from: "USYC", to: "MORPHO", amountUsdc: "11" }), advice({ action: "MOVE", from: "MORPHO", to: "USYC", amountUsdc: "31" }), advice({ action: "MOVE", from: "MORPHO", to: "MORPHO", amountUsdc: "2" }), advice({ action: "MOVE", from: null, to: "CASH", amountUsdc: "2" }), advice({ action: "MOVE", from: "MORPHO", to: "CASH", amountUsdc: "0.5" })]) {
      expect(applyVaultAdvice(engine, envelope, bad, source)).toMatchObject({ kind: "NO_ACTION", advisor: { status: "REJECTED" } });
    }
  });

  it("waits, follows, and rejects an action the envelope does not offer", () => {
    const { engine, envelope } = setup();
    expect(applyVaultAdvice(engine, envelope, advice({ action: "WAIT" }), source)).toMatchObject({ kind: "NO_ACTION", depositMinor: "0", advisor: { status: "APPLIED", action: "WAIT" } });
    expect(applyVaultAdvice(engine, envelope, advice({ action: "FOLLOW" }), source)).toMatchObject({ kind: "INVEST", depositMinor: engine.depositMinor, advisor: { status: "FOLLOWED" } });
    const idle = setup({ idleMinor: "0" });
    expect(applyVaultAdvice(idle.engine, idle.envelope, advice({ action: "ALLOCATE", morphoUsdc: "1", usycUsdc: "0" }), source)).toMatchObject({ kind: "NO_ACTION", advisor: { status: "REJECTED" } });
  });
});

describe("asking the vault advisor", () => {
  it("sends only aggregate figures and the limits, never addresses", async () => {
    const { input, engine, envelope } = setup();
    const call = vi.fn(async () => ({ advice: advice({ action: "ALLOCATE", morphoUsdc: "20", usycUsdc: "20" }), ...source }));
    const decision = await adviseVaultDecision(engine, envelope, vaultAdvisorFacts(input), call);
    expect(decision).toMatchObject({ kind: "INVEST", depositMinor: "40000000" });
    const prompt = (call.mock.calls[0] as unknown as [string])[0];
    expect(prompt).not.toMatch(/0x[0-9a-fA-F]{40}/);
    expect(JSON.parse(prompt)).toMatchObject({ allowedActions: ["FOLLOW", "ALLOCATE", "WAIT", "MOVE"], investableUsdc: "50", facts: { morpho: { apyPercent: "5.00", valueUsdc: "20" }, usyc: { apyPercent: "3.50", depositRoomUsdc: "30" } } });
    expect(vaultAdvisorPrompt(engine, envelope, vaultAdvisorFacts(input))).toContain("engineDecision");
  });

  it("keeps the engine's decision when the model fails or answers out of schema", async () => {
    const { input, engine, envelope } = setup();
    expect(await adviseVaultDecision(engine, envelope, vaultAdvisorFacts(input), async () => { throw new Error("network body with secrets"); })).toMatchObject({ kind: "INVEST", depositMinor: engine.depositMinor, advisor: { status: "UNAVAILABLE" } });
    expect(await adviseVaultDecision(engine, envelope, vaultAdvisorFacts(input), async () => ({ advice: { action: "SELL" } as unknown as VaultAdvice, ...source }))).toMatchObject({ kind: "INVEST", advisor: { status: "UNAVAILABLE" } });
    expect(await adviseVaultDecision(engine, null, vaultAdvisorFacts(input), async () => { throw new Error(); })).toBe(engine);
  });

  it("has a schema strict enough for structured outputs", () => {
    expect(vaultAdviceSchema.safeParse(advice({})).success).toBe(true);
    expect(vaultAdviceSchema.safeParse({ action: "FOLLOW", rationale: "x" }).success).toBe(false);
  });
});
