// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { ADVISOR_MIN_MOVE_MINOR, adviseDecision, advisorEnvelope, advisorFacts, advisorPrompt, applyAdvice, parseUsdc, type Advice, type AdvisorFacts } from "./advisor";
import { decisionSchema, type Decision } from "./models";
import { sampleWorkspace } from "@/test/fixtures";

const USDC = 1_000_000n;
const engine = (patch: Partial<Decision> = {}): Decision => ({ kind: "INVEST", depositMinor: (100n * USDC).toString(), withdrawMinor: "0", transferMinor: "0", remainingBudgetMinor: (500n * USDC).toString(), protectedMinor: "0", explanation: "Invest only arrived agent cash.", ...patch });
const agent = { cashMinor: 150n * USDC, redeemableMinor: 80n * USDC, positionMinor: 90n * USDC, feeReserveMinor: 2n * USDC };
const source = { provider: "GROQ", model: "openai/gpt-oss-120b" };
const advice = (patch: Partial<Advice>): Advice => ({ action: "FOLLOW", amountUsdc: null, rationale: "Coverage is healthy.", ...patch });
const facts: AdvisorFacts = { agentCashUsdc: "150", agentMorphoUsdc: "90", agentRedeemableUsdc: "80", vaultApyPercent: "6.12", vaultLiquidityUsdc: "90000", vaultWarnings: 0, ownerLiquidUsdc: "184250", protectedUsdc: "6501", deployableUsdc: "202709", upcomingObligationsUsdc: "6500", daysToNextBill: 2, coverageStatus: "SAFE", budgetLeftUsdc: "500", maxPerRunUsdc: "500", reserveUsdc: "0", maxMorphoPercent: "60.00" };

describe("advisorEnvelope", () => {
  it("lets the advisor follow, invest less, wait or de-risk an INVEST decision", () => {
    expect(advisorEnvelope(engine(), agent)).toEqual({ actions: ["FOLLOW", "REDUCE", "WAIT", "DE_RISK"], maxDepositMinor: 100n * USDC, maxDeRiskMinor: 80n * USDC });
  });

  it("only offers de-risking on NO_ACTION, and nothing when there is nothing to de-risk", () => {
    expect(advisorEnvelope(engine({ kind: "NO_ACTION", depositMinor: "0" }), agent)).toMatchObject({ actions: ["FOLLOW", "DE_RISK"], maxDepositMinor: 0n });
    expect(advisorEnvelope(engine({ kind: "NO_ACTION", depositMinor: "0" }), { ...agent, redeemableMinor: 0n })).toBeNull();
  });

  it("never touches safety decisions", () => {
    for (const kind of ["LIQUIDITY_TOP_UP", "RESERVE_REFILL", "RETURN_ALL"] as const) expect(advisorEnvelope(engine({ kind }), agent)).toBeNull();
  });

  it("does not offer a withdrawal the agent cannot pay gas for, and caps it by the smaller of position and redeemable", () => {
    expect(advisorEnvelope(engine(), { ...agent, cashMinor: USDC })?.actions).not.toContain("DE_RISK");
    expect(advisorEnvelope(engine(), { ...agent, redeemableMinor: 200n * USDC })?.maxDeRiskMinor).toBe(90n * USDC);
  });
});

describe("applyAdvice", () => {
  const env = advisorEnvelope(engine(), agent)!;

  it("keeps the engine's decision when following, recording the reason", () => {
    const decision = applyAdvice(engine(), env, advice({}), source);
    expect(decision).toMatchObject({ kind: "INVEST", depositMinor: "100000000", explanation: "Invest only arrived agent cash.", advisor: { status: "FOLLOWED", action: "FOLLOW", rationale: "Coverage is healthy.", model: "openai/gpt-oss-120b" } });
    expect(decisionSchema.safeParse(decision).success).toBe(true);
  });

  it("invests less, never more", () => {
    expect(applyAdvice(engine(), env, advice({ action: "REDUCE", amountUsdc: "40.5" }), source)).toMatchObject({ kind: "INVEST", depositMinor: "40500000", explanation: "Advisor: Coverage is healthy.", advisor: { status: "APPLIED", engine: { kind: "INVEST", depositMinor: "100000000" } } });
    expect(applyAdvice(engine(), env, advice({ action: "REDUCE", amountUsdc: "100.000001" }), source)).toMatchObject({ depositMinor: "100000000", advisor: { status: "REJECTED" } });
    expect(applyAdvice(engine(), env, advice({ action: "REDUCE", amountUsdc: "100" }), source)).toMatchObject({ depositMinor: "100000000", advisor: { status: "FOLLOWED" } });
  });

  it("waits by turning the run into no action", () => {
    expect(applyAdvice(engine(), env, advice({ action: "WAIT" }), source)).toMatchObject({ kind: "NO_ACTION", depositMinor: "0", withdrawMinor: "0", transferMinor: "0", advisor: { status: "APPLIED", action: "WAIT" } });
  });

  it("de-risks up to what can be redeemed, into the agent's own cash only", () => {
    expect(applyAdvice(engine(), env, advice({ action: "DE_RISK", amountUsdc: "80" }), source)).toMatchObject({ kind: "DE_RISK", depositMinor: "0", withdrawMinor: "80000000", transferMinor: "0", advisor: { status: "APPLIED" } });
    expect(applyAdvice(engine(), env, advice({ action: "DE_RISK", amountUsdc: "80.000001" }), source)).toMatchObject({ kind: "INVEST", advisor: { status: "REJECTED" } });
  });

  it("rejects actions outside the envelope, dust and malformed amounts", () => {
    const noAction = advisorEnvelope(engine({ kind: "NO_ACTION", depositMinor: "0" }), agent)!;
    expect(applyAdvice(engine({ kind: "NO_ACTION", depositMinor: "0" }), noAction, advice({ action: "REDUCE", amountUsdc: "10" }), source)).toMatchObject({ kind: "NO_ACTION", advisor: { status: "REJECTED" } });
    for (const amountUsdc of [null, "0.5", "-5", "1e3", "12.1234567", "abc", "1,000"]) {
      expect(applyAdvice(engine(), env, advice({ action: "REDUCE", amountUsdc }), source).advisor?.status).toBe("REJECTED");
    }
  });

  it("cleans the rationale: no control characters, bounded length", () => {
    const decision = applyAdvice(engine(), env, advice({ rationale: "line one\nline\u0007two " + "x".repeat(900) }), source);
    expect(decision.advisor!.rationale).not.toMatch(/[\n\u0007]/);
    expect(decision.advisor!.rationale.length).toBeLessThanOrEqual(400);
  });
});

describe("parseUsdc", () => {
  it("reads plain USDC amounts with up to 6 decimals", () => {
    expect(parseUsdc("1")).toBe(USDC);
    expect(parseUsdc(" 2.5 ")).toBe(2_500_000n);
    expect(parseUsdc("0.000001")).toBe(1n);
    expect(ADVISOR_MIN_MOVE_MINOR).toBe(USDC);
  });
});

describe("adviseDecision", () => {
  it("asks the model once with aggregate figures only and applies the answer", async () => {
    const call = vi.fn(async () => ({ advice: advice({ action: "REDUCE", amountUsdc: "25" }), ...source }));
    const decision = await adviseDecision(engine(), advisorEnvelope(engine(), agent), facts, call);
    expect(decision).toMatchObject({ depositMinor: "25000000", advisor: { status: "APPLIED", provider: "GROQ" } });
    expect(call).toHaveBeenCalledTimes(1);
    const prompt = JSON.parse((call.mock.calls[0] as unknown as [string])[0]);
    expect(prompt).toMatchObject({ allowedActions: ["FOLLOW", "REDUCE", "WAIT", "DE_RISK"], maxDepositUsdc: "100", maxDeRiskUsdc: "80", engineDecision: { kind: "INVEST", depositUsdc: "100" } });
    expect(JSON.stringify(prompt)).not.toMatch(/0x[0-9a-fA-F]{6,}/);
  });

  it("leaves the engine's decision when the model fails or answers nonsense", async () => {
    const failing = vi.fn(async () => { throw new Error("HTTP 429 secret-detail"); });
    const decision = await adviseDecision(engine(), advisorEnvelope(engine(), agent), facts, failing);
    expect(decision).toMatchObject({ kind: "INVEST", depositMinor: "100000000", advisor: { status: "UNAVAILABLE" } });
    expect(JSON.stringify(decision)).not.toContain("secret-detail");
    const garbage = vi.fn(async () => ({ advice: { action: "SELL_EVERYTHING" } as unknown as Advice, ...source }));
    expect(await adviseDecision(engine(), advisorEnvelope(engine(), agent), facts, garbage)).toMatchObject({ depositMinor: "100000000", advisor: { status: "UNAVAILABLE" } });
  });

  it("does not call the model when the decision is not the advisor's", async () => {
    const call = vi.fn();
    const safety = engine({ kind: "LIQUIDITY_TOP_UP", depositMinor: "0", transferMinor: "5000000" });
    expect(await adviseDecision(safety, advisorEnvelope(safety, agent), facts, call)).toEqual(safety);
    expect(call).not.toHaveBeenCalled();
  });

  it("states the envelope in the prompt so the model knows its limits", () => {
    expect(JSON.parse(advisorPrompt(engine(), advisorEnvelope(engine(), agent)!, facts)).facts.coverageStatus).toBe("SAFE");
  });
});

describe("advisorFacts", () => {
  it("summarises the treasury without names, recipients or addresses", () => {
    const usdc = (minorUnits: string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits });
    const now = new Date(sampleWorkspace.updatedAt);
    const result = advisorFacts({ workspace: sampleWorkspace, cash: usdc("150000000"), ownerCash: usdc("1000000000"), agentPosition: { walletAddress: "0x0000000000000000000000000000000000000001", vaultAddress: "0x0000000000000000000000000000000000000002", currentBalance: usdc("90000000"), redeemable: usdc("80000000"), liquidityStatus: "READY", shares: "1", apyBps: 612, pnl: { status: "PENDING" }, observedAt: now.toISOString() } as never, vault: { apyBps: 612, liquidity: usdc("90000000000"), warnings: [], earnKitWarnings: [] }, mandate: { reserveMinor: "0", maxPerRunMinor: "500000000", maxMorphoBps: 6000 }, remainingBudgetMinor: "500000000", now });
    expect(result).toMatchObject({ agentCashUsdc: "150", agentMorphoUsdc: "90", agentRedeemableUsdc: "80", vaultApyPercent: "6.12", maxMorphoPercent: "60.00", vaultWarnings: 0 });
    const text = JSON.stringify(result);
    for (const item of sampleWorkspace.obligations) { expect(text).not.toContain(item.title); if (item.recipient) expect(text).not.toContain(item.recipient); }
    expect(text).not.toMatch(/0x[0-9a-fA-F]{6,}/);
  });
});
