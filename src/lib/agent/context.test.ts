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
    const result = await liveWorkspace(workspace, { readSnapshot: async () => snapshot, readPortfolio: async () => { throw new Error("unavailable"); } });
    expect(result.source).toBe("PARTIAL"); expect(result.workspace.totalTreasury).toEqual(usdc("20000000"));
    expect(result.workspace.strategies[1]).toMatchObject({ balance: usdc("0"), redeemable: usdc("0"), apyBps: null, integration: "UNAVAILABLE" });
  });
});
