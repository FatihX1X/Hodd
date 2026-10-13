// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sampleWorkspace } from "@/test/fixtures";

const m = vi.hoisted(() => ({
  controls: new Map<string, boolean>(), configured: true, groq: vi.fn(), started: [] as { p_decision: { kind: string; depositMinor: string; withdrawMinor: string; advisor?: { status: string } }; p_snapshot: { trigger: string } }[],
  mandate: { budgetMinor: "1000000000", reserveMinor: "0", maxPerRunMinor: "1000000000", maxMorphoBps: 6000, enabled: true, paused: false, advisorEnabled: true } as Record<string, unknown>,
  engine: { kind: "INVEST", depositMinor: "100000000", withdrawMinor: "0", transferMinor: "0", remainingBudgetMinor: "1000000000", protectedMinor: "0", explanation: "Invest" } as Record<string, unknown>,
  returnRequested: false,
}));
vi.mock("server-only", () => ({}));
vi.mock("./decision", () => ({ decideAutopilot: () => ({ ...m.engine }) }));
vi.mock("./quotes", () => ({ agentEarnQuote: vi.fn(async () => null) }));
vi.mock("./advisor-model", () => ({ advisorConfigured: () => m.configured, groqAdvisor: m.groq }));
vi.mock("@/lib/earn/live-controls", () => ({ liveControls: async () => m.controls }));
vi.mock("@/lib/earn/gateway", () => ({ arcClient: {} }));
vi.mock("@/lib/earn/capture", () => ({ captureNextEarnCall: vi.fn() }));
vi.mock("@/lib/earn/receipts", () => ({ verifyApprovalReceipt: vi.fn(), verifyEarnReceipt: vi.fn() }));
vi.mock("./circle", () => ({ agentAdapter: vi.fn() }));
vi.mock("./inputs", () => ({ agentInputs: async () => {
  const usdc = (minorUnits: string) => ({ currency: "USDC", decimals: 6, minorUnits });
  const now = new Date().toISOString();
  return { wallet: { address: "0x0000000000000000000000000000000000000001", owner_address: "0x0000000000000000000000000000000000000002" }, stored: { revision: 1, spent_minor: "0", return_requested: m.returnRequested, mandate: m.mandate },
    workspace: sampleWorkspace, workspaceRevision: 3, vault: { address: "0xaabbef1d3971c710276ed41ec791bbe14cdb8e88", name: "Morpho", apyBps: 612, liquidity: usdc("90000000000"), warnings: [], earnKitWarnings: [] }, ownerPositions: [],
    agentPosition: { currentBalance: usdc("90000000"), redeemable: usdc("80000000"), liquidityStatus: "READY", observedAt: now }, cash: { balance: usdc("150000000") }, ownerCash: { balance: usdc("1000000000") }, feeReserveMinor: "2000000", gasPriceWei: "20000000000" };
} }));
vi.mock("./store", () => ({
  openRun: async () => null,
  agentDb: () => ({
    rpc: async (name: string, args: (typeof m.started)[number]) => { if (name === "hodd_start_agent_run") m.started.push(args); return { error: null }; },
    from: () => { const query = { select: () => query, eq: () => query, single: async () => ({ data: { id: "run", state: "COMPLETED" }, error: null }) }; return query; },
  }),
  patchRun: vi.fn(), patchRunDecision: vi.fn(), patchStep: vi.fn(),
}));
import { startAgentRun } from "./runner";

beforeEach(() => {
  m.controls = new Map([["AGENT", true], ["EXECUTION", true], ["AGENT_ADVISOR", true]]); m.configured = true; m.started = []; m.returnRequested = false;
  m.mandate = { ...m.mandate, advisorEnabled: true };
  m.engine = { kind: "INVEST", depositMinor: "100000000", withdrawMinor: "0", transferMinor: "0", remainingBudgetMinor: "1000000000", protectedMinor: "0", explanation: "Invest" };
  m.groq.mockReset().mockResolvedValue({ advice: { action: "REDUCE", amountUsdc: "40", rationale: "A bill is due in two days; invest less." }, provider: "GROQ", model: "openai/gpt-oss-120b" });
});

describe("startAgentRun with the advisor", () => {
  it("records the advised decision and the trigger, with the engine's own decision kept beside it", async () => {
    await startAgentRun("user", "BILL_PROTECTION");
    expect(m.groq).toHaveBeenCalledTimes(1);
    expect(m.started[0].p_decision).toMatchObject({ kind: "INVEST", depositMinor: "40000000", advisor: { status: "APPLIED", engine: { depositMinor: "100000000" } } });
    expect(m.started[0].p_snapshot.trigger).toBe("BILL_PROTECTION");
  });

  it("asks nothing while the owner, the operator or the server has it off, or for return-all", async () => {
    for (const setup of [() => { m.mandate = { ...m.mandate, advisorEnabled: false }; }, () => { m.controls.delete("AGENT_ADVISOR"); }, () => { m.configured = false; }, () => { m.returnRequested = true; }]) {
      m.started = []; setup();
      await startAgentRun("user");
      expect(m.started[0].p_decision).toMatchObject({ kind: "INVEST", depositMinor: "100000000" });
      expect(m.started[0].p_decision.advisor).toBeUndefined();
      m.mandate = { ...m.mandate, advisorEnabled: true }; m.controls.set("AGENT_ADVISOR", true); m.configured = true; m.returnRequested = false;
    }
    expect(m.groq).not.toHaveBeenCalled();
  });

  it("never sends a safety decision to the model", async () => {
    m.engine = { ...m.engine, kind: "LIQUIDITY_TOP_UP", depositMinor: "0", transferMinor: "5000000" };
    await startAgentRun("user");
    expect(m.groq).not.toHaveBeenCalled();
    expect(m.started[0].p_decision).toMatchObject({ kind: "LIQUIDITY_TOP_UP", transferMinor: "5000000" });
  });

  it("falls back to the engine when Groq fails", async () => {
    m.groq.mockRejectedValue(new Error("429"));
    await startAgentRun("user");
    expect(m.started[0].p_decision).toMatchObject({ kind: "INVEST", depositMinor: "100000000", advisor: { status: "UNAVAILABLE" } });
  });
});
