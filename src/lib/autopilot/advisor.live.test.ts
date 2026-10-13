// @vitest-environment node
// LIVE check of the Autopilot advisor against Groq. Sends aggregate test figures only; no wallet, no transaction.
// Run: AUTOPILOT_ADVISOR_LIVE=1 GROQ_API_KEY=... corepack pnpm exec vitest run src/lib/autopilot/advisor.live.test.ts
import { describe, expect, it, vi } from "vitest";
import type { Decision } from "./models";

vi.mock("server-only", () => ({}));
const live = process.env.AUTOPILOT_ADVISOR_LIVE === "1";

describe.runIf(live)("Autopilot advisor on Groq (live)", () => {
  it("answers inside the engine's envelope with a rationale", async () => {
    const { groqAdvisor } = await import("./advisor-model");
    const { adviseDecision, advisorEnvelope } = await import("./advisor");
    const engine: Decision = { kind: "INVEST", depositMinor: "100000000", withdrawMinor: "0", transferMinor: "0", remainingBudgetMinor: "500000000", protectedMinor: "6500000000", explanation: "Invest only arrived agent cash after fees and reserve, within the engine's deployable capital and both Morpho caps." };
    const envelope = advisorEnvelope(engine, { cashMinor: 150_000_000n, redeemableMinor: 80_000_000n, positionMinor: 90_000_000n, feeReserveMinor: 2_000_000n });
    const decision = await adviseDecision(engine, envelope, { agentCashUsdc: "150", agentMorphoUsdc: "90", agentRedeemableUsdc: "80", vaultApyPercent: "6.12", vaultLiquidityUsdc: "90000", vaultWarnings: 0, ownerLiquidUsdc: "184250", protectedUsdc: "6501", deployableUsdc: "202709", upcomingObligationsUsdc: "6500", daysToNextBill: 2, coverageStatus: "SAFE", budgetLeftUsdc: "500", maxPerRunUsdc: "500", reserveUsdc: "0", maxMorphoPercent: "60.00" }, groqAdvisor);
    console.log("\n[advisor-live]", JSON.stringify({ kind: decision.kind, depositMinor: decision.depositMinor, withdrawMinor: decision.withdrawMinor, advisor: decision.advisor }, null, 2));
    expect(decision.advisor?.status).not.toBe("UNAVAILABLE");
    expect(decision.advisor?.rationale.length).toBeGreaterThan(10);
    expect(BigInt(decision.depositMinor)).toBeLessThanOrEqual(100_000_000n);
  }, 60_000);
});
