// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { EarnContext } from "./server-quotes";
import type { EarnQuote } from "./models";
const fake = vi.hoisted(() => ({ leases: new Set<string>(), consumed: new Set<string>(), records: new Map(), policy: vi.fn(), current: vi.fn(), live: vi.fn(), position: vi.fn(), verify: vi.fn(), transaction: vi.fn(), receipt: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(), writeFile: vi.fn(async (path: string) => { if (fake.leases.has(path)) throw new Error("EEXIST"); fake.leases.add(path); }), unlink: vi.fn(async (path: string) => { fake.leases.delete(path); }) }));
vi.mock("./server-context", () => ({ assertEarnContextCurrent: fake.current }));
vi.mock("./server-policy", () => ({ assessEarnOperation: fake.policy }));
vi.mock("./server-quotes", () => ({ freshEarnInputs: fake.live }));
vi.mock("./receipts", () => ({ verifyEarnReceipt: fake.verify, verifyApprovalReceipt: fake.verify }));
vi.mock("@/lib/circle/user-wallet-server", () => ({ circleUserWalletClient: vi.fn() }));
vi.mock("@circle-fin/adapter-circle-wallets/ucw/server", () => ({ createCircleUserWalletAdapter: vi.fn() }));
vi.mock("@circle-fin/adapter-viem-v2/next", () => ({ externalSigning: (options: object) => options, createViemAdapter: (options: object) => options }));
vi.mock("./durable-quotes", () => ({ digest: (value: string) => value, durableEarnQuotes: {
  read: vi.fn(async (id: string, binding: string) => { const item = fake.records.get(id); if (!item || item.binding !== binding) throw new Error("QUOTE_NOT_AVAILABLE"); return item; }),
  consume: vi.fn(async (id: string) => { if (fake.consumed.has(id)) throw new Error("CONSUMED"); fake.consumed.add(id); return fake.records.get(id); }),
} }));
vi.mock("./gateway", () => {
  const operation = async ({ from }: { from: { adapter: { signing: { sign: (payload: object) => Promise<{ txHash: string }> } } } }) => from.adapter.signing.sign({ fromAddress: "0x0000000000000000000000000000000000000001", chain: { chainId: 5042002 }, calls: [{ to: "0x0000000000000000000000000000000000000002", data: "0x1234", value: 0n }] });
  return { arcClient: { getBlockNumber: vi.fn(async () => 10n), getTransaction: fake.transaction, waitForTransactionReceipt: fake.receipt }, earnKit: { earn: { deposit: operation, withdraw: operation } }, getEarnPosition: fake.position, operationConfig: () => ({}) };
});
import { inspectEarnJob, replyToEarnJob, startEarnJob } from "./jobs";
const hash = `0x${"1".repeat(64)}`;
const money = (minorUnits: string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits });
const context = { binding: "alice-session-wallet", policyDigest: "policy", wallet: { address: "0x0000000000000000000000000000000000000001", provider: "INJECTED_METAMASK", accountType: "EOA" } } as unknown as EarnContext;
function record(operation: EarnQuote["operation"] = "DEPOSIT") {
  const quoteId = randomUUID();
  const quote: EarnQuote = { quoteId, operation, walletAddress: context.wallet.address, vaultAddress: "0x0000000000000000000000000000000000000002", vaultName: "Vault", amount: money("1000000"), fees: money("10000"), gasFees: [{ name: "Gas", amount: money("10000") }], expectedShares: null, sharesToRedeem: null, maxWithdrawable: money("2000000"), warnings: [], requiresWarningAcknowledgement: false, policy: { status: "PASS", label: "Policy", reason: "Fresh" }, expiresAt: new Date(Date.now() + 300000).toISOString() };
  fake.records.set(quoteId, { quote, binding: context.binding, policyDigest: context.policyDigest }); return quoteId;
}
async function pending(id: string) { await vi.waitFor(() => expect(inspectEarnJob(context, id).pending).not.toBeNull()); return inspectEarnJob(context, id).pending!; }
beforeEach(() => {
  vi.clearAllMocks(); fake.leases.clear(); fake.consumed.clear(); fake.records.clear(); fake.current.mockResolvedValue(undefined);
  fake.policy.mockReturnValue({ status: "PASS" }); fake.verify.mockReturnValue(undefined);
  fake.live.mockResolvedValue({ workspace: { liquidUsdc: money("10000000") }, positions: [], position: { redeemable: money("2000000") }, vault: { warnings: [], earnKitWarnings: [] } });
  fake.transaction.mockResolvedValue({ from: context.wallet.address, to: "0x0000000000000000000000000000000000000002", input: "0x1234", value: 0n });
  fake.receipt.mockResolvedValue({ status: "success", blockNumber: 11n, gasUsed: 21000n, effectiveGasPrice: 20000000000n, transactionHash: hash });
  fake.position.mockResolvedValue({ walletAddress: context.wallet.address, vaultAddress: "0x0000000000000000000000000000000000000002", vaultName: "Vault", currentBalance: money("0"), maxWithdrawable: money("0"), redeemable: money("0"), liquidityStatus: "READY", shares: "0", apyBps: 0, pnl: { status: "UNAVAILABLE", reason: "No history" }, observedAt: new Date().toISOString() });
});
describe("user-approved Earn orchestration", () => {
  it("waits for the provider signature and verifies the resulting receipt", async () => {
    const id = record(); await startEarnJob(context, id, false); const request = await pending(id);
    expect(fake.receipt).not.toHaveBeenCalled();
    await replyToEarnJob(context, id, { requestId: request.id, txHash: hash });
    await vi.waitFor(() => expect(inspectEarnJob(context, id).state).toBe("COMPLETE"));
    expect(fake.verify).toHaveBeenCalled(); expect(fake.leases.size).toBe(0);
    await expect(replyToEarnJob(context, id, { requestId: request.id, txHash: hash })).rejects.toThrow("already answered");
    await expect(startEarnJob(context, id, false)).rejects.toThrow("consumed");
  });
  it("rejects parallel quotes and cross-user execution access", async () => {
    const id = record(); await startEarnJob(context, id, false); const request = await pending(id);
    await expect(startEarnJob(context, record(), false)).rejects.toThrow("Another wallet");
    expect(() => inspectEarnJob({ ...context, binding: "bob" }, id)).toThrow("unavailable");
    await replyToEarnJob(context, id, { requestId: request.id, cancelled: true });
    await vi.waitFor(() => expect(inspectEarnJob(context, id).state).toBe("FAILED"));
  });
  it("keeps ambiguous submissions locked and never retries", async () => {
    const id = record(); await startEarnJob(context, id, false); const request = await pending(id);
    await replyToEarnJob(context, id, { requestId: request.id, cancelled: true, uncertain: true });
    await vi.waitFor(() => expect(inspectEarnJob(context, id).state).toBe("UNKNOWN")); expect(fake.leases.size).toBe(1); expect(fake.receipt).not.toHaveBeenCalled();
  });
  it("blocks changed policy, new warnings and insufficient liquidity before consuming", async () => {
    const id = record("WITHDRAW");
    await expect(startEarnJob({ ...context, policyDigest: "changed" }, id, false)).rejects.toThrow("changing");
    fake.live.mockResolvedValueOnce({ vault: { earnKitWarnings: ["New risk"], warnings: [] } });
    await expect(startEarnJob(context, id, false)).rejects.toThrow("warnings");
    fake.policy.mockReturnValue({ status: "BLOCKED" }); await expect(startEarnJob(context, id, false)).rejects.toThrow("no longer permits"); expect(fake.consumed.size).toBe(0);
  });
  it("reports residual redeem shares as PARTIAL without a second transaction", async () => {
    fake.position.mockResolvedValue({ ...await fake.position(), shares: "0.000001" });
    const id = record("REDEEM_ALL"); await startEarnJob(context, id, false); const request = await pending(id);
    await replyToEarnJob(context, id, { requestId: request.id, txHash: hash });
    await vi.waitFor(() => expect(inspectEarnJob(context, id).state).toBe("PARTIAL")); expect(fake.transaction).toHaveBeenCalledTimes(1);
  });
});
