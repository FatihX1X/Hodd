// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import type { EarnContext } from "./server-quotes";
import type { EarnQuote } from "./models";
const fake = vi.hoisted(() => ({ leases: new Set<string>(), consumed: new Set<string>(), records: new Map(), policy: vi.fn(), current: vi.fn(), live: vi.fn(), position: vi.fn(), verify: vi.fn(), transaction: vi.fn(), receipt: vi.fn(), estimate: vi.fn(), gasPrice: vi.fn(), callData: "0x1234", steps: null as string[] | null }));
vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", () => ({ mkdir: vi.fn(), writeFile: vi.fn(async (path: string) => { if (fake.leases.has(path)) throw new Error("EEXIST"); fake.leases.add(path); }), unlink: vi.fn(async (path: string) => { fake.leases.delete(path); }) }));
vi.mock("./server-context", () => ({ assertEarnContextCurrent: fake.current }));
vi.mock("./server-policy", () => ({ assessEarnOperation: fake.policy }));
vi.mock("./server-quotes", () => ({ freshEarnInputs: fake.live }));
vi.mock("./receipts", () => ({ verifyEarnReceipt: fake.verify, verifyApprovalReceipt: fake.verify }));
vi.mock("./provider-evidence", () => ({ recordEarnEvidence: vi.fn() }));
vi.mock("@/lib/circle/user-wallet-server", () => ({ circleUserWalletClient: vi.fn() }));
vi.mock("@circle-fin/adapter-circle-wallets/ucw/server", () => ({ createCircleUserWalletAdapter: vi.fn() }));
vi.mock("@circle-fin/adapter-viem-v2/next", () => ({ externalSigning: (options: object) => options, createViemAdapter: (options: object) => options }));
vi.mock("./durable-quotes", () => ({ digest: (value: string) => value, durableEarnQuotes: {
  read: vi.fn(async (id: string, binding: string) => { const item = fake.records.get(id); if (!item || item.binding !== binding) throw new Error("QUOTE_NOT_AVAILABLE"); return item; }),
  consume: vi.fn(async (id: string) => { if (fake.consumed.has(id)) throw new Error("CONSUMED"); fake.consumed.add(id); return fake.records.get(id); }),
} }));
vi.mock("./gateway", () => {
  const operation = async ({ from }: { from: { adapter: { signing: { sign: (payload: object) => Promise<{ txHash: string }> } } } }) => {
    let result = { txHash: "" };
    for (const data of fake.steps ?? [fake.callData]) result = await from.adapter.signing.sign({ fromAddress: "0x0000000000000000000000000000000000000001", chain: { chainId: 5042002 }, calls: [{ to: "0x0000000000000000000000000000000000000002", data, value: 0n }] });
    return result;
  };
  return { arcClient: { getBlockNumber: vi.fn(async () => 10n), getGasPrice: fake.gasPrice, estimateGas: fake.estimate, getTransaction: fake.transaction, waitForTransactionReceipt: fake.receipt }, earnKit: { earn: { deposit: operation, withdraw: operation } }, getEarnPosition: fake.position, operationConfig: () => ({}) };
});
import { claimTestSignerRequest, inspectEarnJob, replyToEarnJob, startEarnJob } from "./jobs";
const hash = `0x${"1".repeat(64)}`;
const money = (minorUnits: string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits });
const context = { binding: "alice-session-wallet", policyDigest: "policy", wallet: { address: "0x0000000000000000000000000000000000000001", provider: "INJECTED_METAMASK", accountType: "EOA" } } as unknown as EarnContext;
function record(operation: EarnQuote["operation"] = "DEPOSIT") {
  const quoteId = randomUUID();
  const quote: EarnQuote = { quoteId, operation, walletAddress: context.wallet.address, vaultAddress: "0x0000000000000000000000000000000000000002", vaultName: "Vault", amount: money("1000000"), fees: money("10000"), gasFees: [{ name: operation === "DEPOSIT" ? "Deposit" : "Withdraw", amount: money("10000"), gasLimit: "30000", maxGasPriceWei: "20000000000" }], expectedShares: null, sharesToRedeem: null, maxWithdrawable: money("2000000"), warnings: [], requiresWarningAcknowledgement: false, policy: { status: "PASS", label: "Policy", reason: "Fresh" }, expiresAt: new Date(Date.now() + 300000).toISOString() };
  fake.records.set(quoteId, { quote, binding: context.binding, policyDigest: context.policyDigest }); return quoteId;
}
async function pending(id: string) { await vi.waitFor(() => expect(inspectEarnJob(context, id).pending).not.toBeNull()); return inspectEarnJob(context, id).pending!; }
beforeEach(() => {
  vi.clearAllMocks(); fake.leases.clear(); fake.consumed.clear(); fake.records.clear(); fake.callData = "0x1234"; fake.steps = null; fake.current.mockResolvedValue(undefined);
  fake.estimate.mockResolvedValue(21000n); fake.gasPrice.mockResolvedValue(10000000000n);
  fake.policy.mockReturnValue({ status: "PASS" }); fake.verify.mockReturnValue(undefined);
  fake.live.mockResolvedValue({ workspace: { liquidUsdc: money("10000000") }, positions: [], position: { redeemable: money("2000000") }, vault: { warnings: [], earnKitWarnings: [] } });
  fake.transaction.mockResolvedValue({ from: context.wallet.address, to: "0x0000000000000000000000000000000000000002", input: "0x1234", value: 0n });
  fake.receipt.mockResolvedValue({ status: "success", blockNumber: 11n, gasUsed: 21000n, effectiveGasPrice: 20000000000n, transactionHash: hash });
  fake.position.mockResolvedValue({ walletAddress: context.wallet.address, vaultAddress: "0x0000000000000000000000000000000000000002", vaultName: "Vault", currentBalance: money("0"), maxWithdrawable: money("0"), redeemable: money("0"), liquidityStatus: "READY", shares: "0", apyBps: 0, pnl: { status: "UNAVAILABLE", reason: "No history" }, observedAt: new Date().toISOString() });
});
describe("user-approved Earn orchestration", () => {
  it("blocks SCA quotes before consumption, lease, challenge or signature", async () => {
    const id = record();
    await expect(startEarnJob({ ...context, wallet: { ...context.wallet, provider: "CIRCLE_USER_CONTROLLED", accountType: "SCA" } }, id, false)).rejects.toMatchObject({ code: "SCA_FEE_CEILING_UNSUPPORTED" });
    expect(fake.consumed.size).toBe(0); expect(fake.leases.size).toBe(0);
    expect(fake.live).not.toHaveBeenCalled(); expect(fake.receipt).not.toHaveBeenCalled();
  });
  it("returns only safe diagnostics on a pre-signature failure", async () => {
    fake.current.mockRejectedValueOnce({ message: "secret-request-header", cause: { trace: { response: { data: { code: 155104, message: "secret-token" } } } } });
    const id = record(); await startEarnJob(context, id, false);
    await vi.waitFor(() => expect(inspectEarnJob(context, id).state).toBe("FAILED"));
    const failed = inspectEarnJob(context, id);
    expect(failed.failure).toEqual({ code: "SDK_FAILURE", stage: "SIGNING_PREPARATION", providerCode: "155104" });
    expect(JSON.stringify(failed)).not.toContain("secret-");
    expect(fake.receipt).not.toHaveBeenCalled(); expect(fake.leases.size).toBe(0);
  });
  it("waits for the provider signature and verifies the resulting receipt", async () => {
    const id = record(); await startEarnJob(context, id, false); const request = await pending(id);
    expect(request.gasCeiling).toEqual({ gasLimit: "30000", gasPriceWei: "20000000000" });
    expect(fake.receipt).not.toHaveBeenCalled();
    await replyToEarnJob(context, id, { requestId: request.id, txHash: hash });
    await vi.waitFor(() => expect(inspectEarnJob(context, id).state).toBe("COMPLETE"));
    expect(fake.verify).toHaveBeenCalled(); expect(fake.leases.size).toBe(0);
    await expect(replyToEarnJob(context, id, { requestId: request.id, txHash: hash })).rejects.toThrow("already answered");
    await expect(startEarnJob(context, id, false)).rejects.toThrow("consumed");
  });
  it("recognizes Earn Kit increaseAllowance as an approval and enforces its quoted gas ceiling", async () => {
    fake.callData = "0x39509351";
    const id = record();
    const bound = fake.records.get(id); bound.quote.gasFees.unshift({ name: "Approve", amount: money("1000"), gasLimit: "40000", maxGasPriceWei: "20000000000" });
    await startEarnJob(context, id, false); const request = await pending(id);
    expect(request.stage).toBe("APPROVAL"); expect(request.gasCeiling?.gasLimit).toBe("40000");
    await replyToEarnJob(context, id, { requestId: request.id, cancelled: true });
    await vi.waitFor(() => expect(inspectEarnJob(context, id).state).toBe("FAILED"));
  });
  it("fails closed and releases the lease when a step after a verified approval stops before signing", async () => {
    // Live regression: fresh-wallet deposit needed more gas than Earn Kit quoted after the approval confirmed.
    fake.steps = ["0x39509351", "0x1234"]; fake.estimate.mockResolvedValueOnce(21000n).mockResolvedValueOnce(50000n);
    fake.transaction.mockResolvedValueOnce({ from: context.wallet.address, to: "0x0000000000000000000000000000000000000002", input: "0x39509351", value: 0n });
    const id = record();
    const bound = fake.records.get(id); bound.quote.gasFees.unshift({ name: "Approve", amount: money("1000"), gasLimit: "40000", maxGasPriceWei: "20000000000" });
    await startEarnJob(context, id, false); const approval = await pending(id);
    expect(approval.stage).toBe("APPROVAL");
    await replyToEarnJob(context, id, { requestId: approval.id, txHash: hash });
    await vi.waitFor(() => expect(inspectEarnJob(context, id).state).toBe("FAILED"));
    const failed = inspectEarnJob(context, id);
    expect(failed.events.map((event) => event.stage)).toContain("APPROVAL_CONFIRMED");
    expect(failed.events.map((event) => event.stage)).not.toContain("EARN_SIGNATURE_REQUESTED");
    expect(failed.failure).toEqual({ code: "FEE_RESERVE_EXCEEDED", stage: "SIGNING_PREPARATION" });
    expect(fake.leases.size).toBe(0);
  });
  it("lets the dev test signer claim only this session's exact pending request, once", async () => {
    const id = record(); await startEarnJob(context, id, false); const request = await pending(id);
    const ceiling = request.gasCeiling!;
    expect(() => claimTestSignerRequest("bob", request.calls, ceiling)).toThrow("No matching");
    expect(() => claimTestSignerRequest(context.binding, [{ ...request.calls[0], data: "0xdeadbeef" }], ceiling)).toThrow("No matching");
    expect(() => claimTestSignerRequest(context.binding, request.calls, { ...ceiling, gasPriceWei: "1" })).toThrow("No matching");
    expect(claimTestSignerRequest(context.binding, request.calls, ceiling)).toEqual({ call: request.calls[0], gasCeiling: ceiling });
    expect(() => claimTestSignerRequest(context.binding, request.calls, ceiling)).toThrow("No matching");
    await replyToEarnJob(context, id, { requestId: request.id, cancelled: true });
    await vi.waitFor(() => expect(inspectEarnJob(context, id).state).toBe("FAILED"));
  });
  it("refuses a gas estimate above the quote before opening a wallet request", async () => {
    fake.estimate.mockResolvedValue(40000n);
    const id = record(); await startEarnJob(context, id, false);
    await vi.waitFor(() => expect(inspectEarnJob(context, id).state).toBe("FAILED"));
    expect(inspectEarnJob(context, id).pending).toBeNull();
    expect(inspectEarnJob(context, id).failure?.code).toBe("FEE_RESERVE_EXCEEDED");
    expect(fake.leases.size).toBe(0);
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
