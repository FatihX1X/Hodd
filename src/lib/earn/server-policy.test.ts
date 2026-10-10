import { describe, expect, it } from "vitest";
import { initialWorkspace, usdc } from "@/test/fixtures";
import { assessEarnOperation } from "./server-policy";
import type { EarnPosition } from "./models";
const now = new Date("2026-10-01T12:00:00Z");
const position: EarnPosition = { walletAddress: "0x0000000000000000000000000000000000000001", vaultAddress: "0x0000000000000000000000000000000000000002", vaultName: "Vault", currentBalance: usdc("0") as EarnPosition["currentBalance"], maxWithdrawable: usdc("0") as EarnPosition["maxWithdrawable"], redeemable: usdc("0") as EarnPosition["redeemable"], liquidityStatus: "READY", shares: "0", apyBps: 100, pnl: { status: "UNAVAILABLE", reason: "No principal" }, observedAt: now.toISOString() };
describe("server-authoritative Earn policy", () => {
  it("preserves protected capital and exact fee rounding", () => {
    expect(assessEarnOperation(initialWorkspace, [position], "DEPOSIT", usdc("4499999999"), usdc("1"), now).status).toBe("PASS");
    expect(assessEarnOperation(initialWorkspace, [position], "DEPOSIT", usdc("4500000000"), usdc("1"), now).status).toBe("BLOCKED");
  });
  it("enforces disabled strategy, allocation cap and minimum coverage", () => {
    const policy = initialWorkspace.policy;
    for (const override of [{ enabledStrategies: { ...policy.enabledStrategies, MORPHO: false } }, { strategyCapsBps: { ...policy.strategyCapsBps, MORPHO: 0 } }, { minimumLiquidityCoverageBps: 30_000 }]) expect(assessEarnOperation({ ...initialWorkspace, policy: { ...policy, ...override } }, [position], "DEPOSIT", usdc("1000000"), usdc("1"), now).status).toBe("BLOCKED");
  });
  it("rejects stale and unavailable positions", () => {
    for (const override of [{ observedAt: new Date(now.getTime() - 60_001).toISOString() }, { liquidityStatus: "UNAVAILABLE" as const }]) expect(assessEarnOperation(initialWorkspace, [{ ...position, ...override }], "DEPOSIT", usdc("1"), usdc("0"), now).status).toBe("BLOCKED");
  });
  it("does not apply investment caps to liquidation", () => {
    expect(assessEarnOperation({ ...initialWorkspace, policy: { ...initialWorkspace.policy, enabledStrategies: { ...initialWorkspace.policy.enabledStrategies, MORPHO: false } } }, [position], "WITHDRAW", usdc("1"), usdc("0"), now).status).toBe("PASS");
  });
  it("rejects mixed currency or decimal contracts", () => {
    expect(() => assessEarnOperation(initialWorkspace, [position], "DEPOSIT", { currency: "USD", minorUnits: "1", decimals: 6 }, usdc("0"), now)).toThrow();
    expect(() => assessEarnOperation(initialWorkspace, [position], "DEPOSIT", { currency: "USDC", minorUnits: "1", decimals: 18 }, usdc("0"), now)).toThrow();
  });
});
