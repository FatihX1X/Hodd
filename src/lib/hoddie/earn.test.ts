import { describe, expect, it } from "vitest";
import { assessTreasury } from "@/lib/treasury/engine";
import { initialWorkspace, usdc } from "@/lib/treasury/fixtures";
import type { EarnPortfolioResponse } from "@/lib/earn/models";
import { morphoDepositLimit, planEarn, type EarnContext } from "./earn";

const eu = (minorUnits: string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits });
const at = new Date("2026-09-27T00:00:00.000Z");
const address = "0x00000000000000000000000000000000000000a1";
const vault = { address, name: "Allowlisted vault", chain: "ARC-TESTNET", protocol: "MORPHO", asset: "USDC", assetAddress: "0x0000000000000000000000000000000000000002", apyBps: 412, totalDeposits: eu("1000000000"), liquidity: eu("900000000"), status: "ACTIVE", circleGuarded: true, warnings: [], earnKitWarnings: [], verifiedAt: "2026-09-27T00:00:00.000Z", verifiedBlock: "1" } as const;
const position = { walletAddress: "0x00000000000000000000000000000000000000b2", vaultAddress: address, vaultName: vault.name, currentBalance: eu("300000000"), maxWithdrawable: eu("300000000"), redeemable: eu("250000000"), liquidityStatus: "READY", shares: "300", apyBps: 412, pnl: { status: "PENDING" }, observedAt: "2026-09-27T00:00:00.000Z" } as const;
const portfolio = (over: Partial<EarnPortfolioResponse> = {}): EarnPortfolioResponse => ({ status: "READY", integration: { discovery: "READY", positionAccess: "READY", execution: "LOCAL_ENABLED", configuredWalletAddress: position.walletAddress, message: "ok" }, vaults: [vault], positions: [], observedAt: "2026-09-27T00:00:00.000Z", ...over }) as EarnPortfolioResponse;
const context = (over: Partial<EarnContext> = {}): EarnContext => { const workspace = structuredClone(initialWorkspace); return { workspace, operationalWorkspace: workspace, assessment: assessTreasury(workspace, at), portfolio: portfolio(), ...over }; };

describe("Morpho proposals", () => {
  it("limits a deposit to deployable capital under the policy cap", () => {
    expect(morphoDepositLimit(context())).toMatchObject({ minorUnits: "4500000000" }); // 10,000 - 4,500 obligations - 1,000 buffer
    const tight = context(); tight.workspace.policy.strategyCapsBps.MORPHO = 1000; // cap 10% of 10,000 = 1,000
    expect(morphoDepositLimit(tight)).toMatchObject({ minorUnits: "1000000000" });
  });

  it("prepares a deposit inside the limit and says what comes next", () => {
    const plan = planEarn(context(), { operation: "DEPOSIT", amount: "1000" });
    expect(plan.lines).toEqual(["Deposit 1,000.00 USDC into Allowlisted vault", "Treasury Engine limit: 4,500.00 USDC", "Next: a fresh server quote, then your own wallet signature."]);
  });

  it("refuses a deposit above the engine limit, whatever the model asked for", () => {
    expect(() => planEarn(context(), { operation: "DEPOSIT", amount: "4500.01" })).toThrow(/above the limit.*4,500.00 USDC/);
    expect(() => planEarn(context(), { operation: "DEPOSIT", amount: "0" })).toThrow();
    expect(() => planEarn(context(), { operation: "DEPOSIT" })).toThrow(/amount is required/i);
  });

  it("refuses deposits when nothing is deployable, the strategy is disabled or the vault is low on liquidity", () => {
    const none = context(); none.workspace.obligations[0] = { ...none.workspace.obligations[0], amount: usdc("9500000000") }; const noneContext = { ...none, assessment: assessTreasury(none.workspace, at) };
    expect(() => planEarn(noneContext, { operation: "DEPOSIT", amount: "1" })).toThrow(/nothing is deployable/i);
    const disabled = context(); disabled.workspace.policy.enabledStrategies.MORPHO = false;
    expect(() => planEarn(disabled, { operation: "DEPOSIT", amount: "1" })).toThrow(/nothing is deployable/i);
    expect(() => planEarn(context({ portfolio: portfolio({ vaults: [{ ...vault, status: "LOW_LIQUIDITY" } as unknown as EarnPortfolioResponse["vaults"][number]] }) }), { operation: "DEPOSIT", amount: "1" })).toThrow(/low on liquidity/);
  });

  it("only uses allowlisted vaults", () => {
    expect(() => planEarn(context(), { operation: "DEPOSIT", amount: "1", vaultAddress: "0x00000000000000000000000000000000000000ff" })).toThrow(/allowlist/);
    expect(planEarn(context(), { operation: "DEPOSIT", amount: "1", vaultAddress: address.toUpperCase().replace("0X", "0x") }).vault.name).toBe("Allowlisted vault");
  });

  it("limits withdrawals to the redeemable position and supports redeem all", () => {
    const held = context({ portfolio: portfolio({ positions: [position] }) });
    expect(planEarn(held, { operation: "WITHDRAW", amount: "250" }).lines[0]).toBe("Withdraw 250.00 USDC from Allowlisted vault");
    expect(() => planEarn(held, { operation: "WITHDRAW", amount: "251" })).toThrow(/at most 250.00 USDC/);
    expect(planEarn(held, { operation: "REDEEM_ALL" }).lines[0]).toBe("Redeem all from Allowlisted vault");
    expect(() => planEarn(context(), { operation: "REDEEM_ALL" })).toThrow(/no redeemable Morpho position/);
  });

  it("cannot prepare anything without loaded vaults or verified figures", () => {
    expect(() => planEarn(context({ portfolio: null }), { operation: "DEPOSIT", amount: "1" })).toThrow(/not loaded/);
    expect(() => planEarn(context({ operationalWorkspace: null, assessment: null }), { operation: "DEPOSIT", amount: "1" })).toThrow(/paused/);
  });

  it("rechecks withdrawals against current vault liquidity and maximum withdrawable", () => {
    const held = context({ portfolio: portfolio({ positions: [{ ...position, maxWithdrawable: eu("100000000") }] }) });
    expect(planEarn(held, { operation: "WITHDRAW", amount: "100" }).limit.minorUnits).toBe("100000000");
    expect(() => planEarn(held, { operation: "WITHDRAW", amount: "101" })).toThrow(/at most/);
    expect(() => planEarn(held, { operation: "REDEEM_ALL" })).toThrow(/Full redemption/);
  });
});
