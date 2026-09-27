import { describe, expect, it, vi } from "vitest";
import { ARC_USDC_ADDRESS } from "./constants";
import { ArcReadError, readArcTreasurySnapshot, type ArcReadClient } from "./reader-core";

const address = "0x0000000000000000000000000000000000000001";
function client({ chainId = 5_042_002, decimals = 6, balance = 20_000_000n }: { chainId?: number; decimals?: number; balance?: bigint } = {}) {
  const readContract = vi.fn(async (args: { functionName: string }) => args.functionName === "decimals" ? decimals : balance);
  return { getChainId: vi.fn(async () => chainId), getBlockNumber: vi.fn(async () => 42n), readContract } as unknown as ArcReadClient;
}

describe("Arc treasury reader", () => {
  it("returns an exact six-decimal USDC snapshot at one block", async () => { const rpc = client(); const snapshot = await readArcTreasurySnapshot(rpc, address, new Date("2026-09-27T12:00:00.000Z")); expect(snapshot).toEqual({ address, chain: "ARC-TESTNET", chainId: 5_042_002, balance: { currency: "USDC", minorUnits: "20000000", decimals: 6 }, blockNumber: "42", observedAt: "2026-09-27T12:00:00.000Z" }); expect(rpc.readContract).toHaveBeenCalledWith(expect.objectContaining({ address: ARC_USDC_ADDRESS, blockNumber: 42n })); });
  it("rejects an invalid address before RPC access", async () => { const rpc = client(); await expect(readArcTreasurySnapshot(rpc, "not-an-address")).rejects.toMatchObject({ code: "INVALID_ADDRESS" }); expect(rpc.getChainId).not.toHaveBeenCalled(); });
  it("rejects a wrong chain", async () => { await expect(readArcTreasurySnapshot(client({ chainId: 5042 }), address)).rejects.toMatchObject({ code: "WRONG_CHAIN" }); });
  it("rejects a non-six-decimal USDC interface", async () => { await expect(readArcTreasurySnapshot(client({ decimals: 18 }), address)).rejects.toMatchObject({ code: "INVALID_USDC" }); });
  it("normalizes RPC failures", async () => { const rpc = client(); vi.mocked(rpc.getChainId).mockRejectedValue(new Error("offline")); await expect(readArcTreasurySnapshot(rpc, address)).rejects.toEqual(expect.objectContaining<Partial<ArcReadError>>({ code: "RPC_UNAVAILABLE" })); });
});
