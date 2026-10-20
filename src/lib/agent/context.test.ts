import { describe, expect, it, vi } from "vitest";
import { initialWorkspace, usdc } from "@/test/fixtures";
import { liveWorkspace } from "./context";
import type { TreasuryWorkspace } from "@/lib/treasury/models";
vi.mock("server-only", () => ({}));

const address = "0x0000000000000000000000000000000000000001";
describe("connector live balances", () => {
  it("reports NOT_CONNECTED with zero balances and no stored yield without reading providers", async () => {
    const workspace = structuredClone(initialWorkspace);
    workspace.pendingTransactions = usdc("5000000");
    const readSnapshot = vi.fn(); const readPortfolio = vi.fn();
    const result = await liveWorkspace(workspace, { readSnapshot, readPortfolio });
    expect(result.source).toBe("NOT_CONNECTED");
    expect(result.workspace.totalTreasury).toEqual(usdc("0"));
    expect(result.workspace.liquidUsdc).toEqual(usdc("0"));
    expect(result.workspace.pendingTransactions).toEqual(usdc("0"));
    expect(result.workspace.strategies.every(item => item.balance.minorUnits === "0" && item.redeemable.minorUnits === "0" && item.apyBps === null)).toBe(true);
    expect(readSnapshot).not.toHaveBeenCalled(); expect(readPortfolio).not.toHaveBeenCalled();
    expect(workspace).toMatchObject({ totalTreasury: usdc("10000000000"), pendingTransactions: usdc("5000000") });
  });
  it("excludes stale strategy balances and yield when live Morpho reads fail", async () => {
    const workspace: TreasuryWorkspace = { ...structuredClone(initialWorkspace), treasuryMode: "ARC_TESTNET_WALLET", walletConnection: { provider: "INJECTED_METAMASK", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address, label: "Test wallet", connectedAt: initialWorkspace.updatedAt } };
    workspace.strategies[1].balance = usdc("999000000"); workspace.strategies[1].redeemable = usdc("999000000");
    const snapshot = { address, chain: "ARC-TESTNET" as const, chainId: 5042002 as const, balance: { ...usdc("20000000"), currency: "USDC" as const, decimals: 6 as const }, blockNumber: "42", observedAt: initialWorkspace.updatedAt };
    const result = await liveWorkspace(workspace, { readSnapshot: async () => snapshot, readPortfolio: async () => { throw new Error("unavailable"); }, readUsyc: async () => null });
    expect(result.source).toBe("PARTIAL"); expect(result.workspace.totalTreasury).toEqual(usdc("20000000"));
    expect(result.workspace.strategies[1]).toMatchObject({ balance: usdc("0"), redeemable: usdc("0"), apyBps: null, integration: "UNAVAILABLE" });
  });
  it("counts the wallet's USYC pool position like the browser and marks a failed USYC read as partial", async () => {
    const workspace: TreasuryWorkspace = { ...structuredClone(initialWorkspace), treasuryMode: "ARC_TESTNET_WALLET", walletConnection: { provider: "INJECTED_METAMASK", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address, label: "Test wallet", connectedAt: initialWorkspace.updatedAt } };
    const snapshot = { address, chain: "ARC-TESTNET" as const, chainId: 5042002 as const, balance: { ...usdc("20000000"), currency: "USDC" as const, decimals: 6 as const }, blockNumber: "42", observedAt: initialWorkspace.updatedAt };
    const portfolio = { integration: { positionAccess: "READY" }, vaults: [], positions: [] } as never;
    const position = { wallet: address, pool: "0x0000000000000000000000000000000000000002", circle: "OK", depositsPaused: false, maxDepositUsdc: "0", shares: "1", usycMinor: "1", valueUsdc: "5000000", maxWithdrawShares: "1", maxWithdrawUsdc: "4000000", priceUsdcPerUsyc: "1000000", subscribePriceUsdcPerUsyc: "1000000", afterHoursPricing: false, observedAt: initialWorkspace.updatedAt } as const;
    const result = await liveWorkspace(workspace, { readSnapshot: async () => snapshot, readPortfolio: async () => portfolio, readUsyc: async () => position });
    expect(result.source).toBe("LIVE"); expect(result.usyc).toEqual(position);
    expect(result.workspace.totalTreasury).toEqual(usdc("25000000"));
    expect(result.workspace.strategies.find((item) => item.kind === "USYC")).toMatchObject({ balance: usdc("5000000"), redeemable: usdc("4000000"), integration: "LIVE" });
    const failed = await liveWorkspace(workspace, { readSnapshot: async () => snapshot, readPortfolio: async () => portfolio, readUsyc: async () => { throw new Error("rpc"); } });
    expect(failed.source).toBe("PARTIAL"); expect(failed.note).toContain("USYC"); expect(failed.workspace.totalTreasury).toEqual(usdc("20000000"));
  });
});
