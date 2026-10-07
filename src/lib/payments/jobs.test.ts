// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace, usdc } from "@/lib/treasury/fixtures";
import type { PaymentRecord } from "./models";
import type { PaymentContext } from "./server";

const fake = vi.hoisted(() => ({ records: new Map<string, PaymentRecord>(), leases: new Set<string>(), current: null as unknown, policy: vi.fn(), proof: vi.fn(), revert: vi.fn(), receipt: vi.fn(), transaction: vi.fn(), readiness: vi.fn(), fee: vi.fn(), circleCreate: vi.fn(), circleAdapter: vi.fn(), authorize: undefined as (() => void) | undefined, cancelFails: false, claimed: false }));
vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs/promises")>()), mkdir: vi.fn(), unlink: vi.fn(async (path: string) => fake.leases.delete(path)), writeFile: vi.fn(async (path: string) => { if (fake.leases.has(path)) throw new Error("exists"); fake.leases.add(path); }) }));
vi.mock("@/lib/earn/durable-quotes", () => ({ digest: (value: unknown) => typeof value === "string" ? value : JSON.stringify(value) }));
vi.mock("@/lib/earn/server-context", () => ({ earnServerContext: vi.fn(async () => { if (!fake.current) throw new Error("expired"); return fake.current; }) }));
vi.mock("./policy", () => ({ assessPayment: fake.policy }));
vi.mock("./receipts", () => ({ verifyPaymentReceipt: fake.proof, verifyPaymentRevert: fake.revert }));
vi.mock("./fees", () => ({ quotePaymentFees: fake.fee }));
vi.mock("@/lib/earn/provider-evidence", () => ({ hasVerifiedEarnProvider: fake.readiness }));
vi.mock("@/lib/circle/user-wallet-server", () => ({ circleUserWalletClient: () => ({ createUserTransactionContractExecutionChallenge: fake.circleCreate }) }));
vi.mock("@circle-fin/adapter-circle-wallets/ucw/server", () => ({ createCircleUserWalletAdapter: fake.circleAdapter }));
vi.mock("./user-operation", () => ({ verifyPaymentUserOperation: vi.fn(async () => ({ success: true })), resolvePaymentUserOperation: vi.fn() }));
vi.mock("@circle-fin/adapter-viem-v2/next", () => ({ createViemAdapter: (input: unknown) => input, externalSigning: (input: unknown) => input }));
vi.mock("@/lib/earn/gateway", () => ({ arcClient: { getChainId: vi.fn(async () => 5042002), waitForTransactionReceipt: fake.receipt, getTransaction: fake.transaction }, earnKit: { send: async ({ from }: { from: { adapter: { signing: { sign: (payload: object) => Promise<{ txHash: string }> } } } }) => ({ state: "success", ...(await from.adapter.signing.sign({ chain: { chainId: 5042002 }, fromAddress: "0x0000000000000000000000000000000000000001", calls: [{ to: "0x3600000000000000000000000000000000000000", data: "0x1234", value: 0n }] })) }) } }));
vi.mock("./server", () => ({ transferCall: () => ({ to: "0x3600000000000000000000000000000000000000", data: "0x1234", value: "0" }), readPayment: async (context: PaymentContext, id: string) => {
  const record = fake.records.get(id);
  if (!record || context.binding !== "alice") throw new Error("unavailable");
  return { record, row: { policy_digest: "policy" } };
}, freshPaymentWorkspace: async () => {
  const workspace = structuredClone(initialWorkspace); workspace.obligations[0].revision = 1;
  if (fake.claimed) { const record = [...fake.records.values()].find((item) => item.state === "AWAITING_SIGNATURE")!; workspace.paymentReservations = [{ proposalId: record.id, obligationId: record.proposal.obligationId, amount: record.proposal.amount, feeReserve: record.proposal.feeReserve }]; workspace.pendingTransactions = usdc((BigInt(record.proposal.amount.minorUnits) + BigInt(record.proposal.feeReserve.minorUnits)).toString()); }
  return workspace;
} }));
vi.mock("./admin", () => ({ paymentAdmin: () => ({ rpc: async (name: string, params: Record<string, string>) => {
  const record = fake.records.get(params.p_id)!;
  if (name === "hodd_cancel_payment" && fake.cancelFails) return { error: {} };
  if (name === "hodd_claim_payment") {
    if (record.state !== "REVIEW_REQUIRED") return { error: {} };
    record.state = "AWAITING_SIGNATURE"; fake.claimed = true;
  } else if (name === "hodd_finish_payment") { record.state = "CONFIRMED"; record.txHash = params.p_hash; }
  else record.state = "FAILED";
  return { error: null };
}, from: () => ({ update: (values: Partial<PaymentRecord> & { tx_hash?: string; user_operation_hash?: string }) => {
  let id = "";
  const query = { eq: (key: string, value: string) => { if (key === "id") id = value; return query; }, in: () => query, is: () => query, then: (resolve: (value: object) => void) => { const record = fake.records.get(id)!; Object.assign(record, values, values.tx_hash ? { txHash: values.tx_hash } : {}, values.user_operation_hash ? { userOperationHash: values.user_operation_hash } : {}); resolve({ error: null }); } };
  return query;
} }) }) }));
import { inspectPayment, replyPayment, startPayment, recheckPayment } from "./jobs";
import { ARC_GAS_STATION_PAYMASTER } from "@/lib/wallet/fee-quote";
const hash = `0x${"1".repeat(64)}`;
const context = { binding: "alice", policyDigest: "policy", scope: "TREASURY", userId: "alice", wallet: { provider: "INJECTED_METAMASK", accountType: "EOA", address: "0x0000000000000000000000000000000000000001" } } as PaymentContext;
const fee = () => { const now = Date.now(); return { provider: context.wallet.provider as "INJECTED_METAMASK", walletAddress: context.wallet.address, chainId: 5042002 as const, source: "ARC_EOA" as const, operationDigest: JSON.stringify({ to: "0x3600000000000000000000000000000000000000", data: "0x1234", value: "0" }), observedAt: new Date(now).toISOString(), expiresAt: new Date(now+300000).toISOString(), sponsorship: "NOT_ASSUMED" as const, gasLimit: "50000", maxFeePerGasWei: "20000000000", priorityFeePerGasWei: "0", maxNativeFeeWei: "1000000000000000", maxWalletDebit: { currency: "USDC" as const, decimals: 6 as const, minorUnits: "1000" } }; };
function record() {
  const id = randomUUID();
  fake.records.set(id, { id, state: "REVIEW_REQUIRED", txHash: null, userOperationHash: null, receipt: null, proposal: { id, obligationId: "obl-payroll-oct", obligationRevision: 1, wallet: context.wallet, amount: usdc("4000000000"), feeReserve: usdc("1000"), feeQuote: fee(), gasBudgetWei: "1000000000000000", expiresAt: new Date(Date.now()+300000).toISOString(), executionEnabled: true, executionReason: "Verified", startBlock: "10" } } as PaymentRecord);
  return id;
}
async function pending(id: string) { await vi.waitFor(async () => expect((await inspectPayment(context, id)).pending).not.toBeNull()); return (await inspectPayment(context, id)).pending!; }
beforeEach(() => { vi.clearAllMocks(); fake.records.clear(); fake.leases.clear(); fake.claimed = false; fake.cancelFails = false; fake.current = context; fake.readiness.mockResolvedValue(true); fake.fee.mockImplementation(async () => fee()); fake.policy.mockReturnValue({ status: "PASS" }); fake.proof.mockReturnValue({}); fake.revert.mockReturnValue({ status: "REVERTED" }); fake.receipt.mockResolvedValue({ status: "success" }); fake.transaction.mockResolvedValue({ from: context.wallet.address, to: "0x3600000000000000000000000000000000000000", input: "0x1234", value: 0n }); });
describe("payment signing orchestration", () => {
  it("claims once, waits for separate signing, verifies evidence and finalizes the server ledger", async () => {
    const id = record(); await startPayment(context, id); const request = await pending(id);
    await expect(startPayment(context, id)).rejects.toThrow("fresh");
    await replyPayment(context, id, { requestId: request.id, txHash: hash });
    await vi.waitFor(async () => expect((await inspectPayment(context, id)).record.state).toBe("CONFIRMED"));
    expect(fake.proof).toHaveBeenCalled(); await vi.waitFor(() => expect(fake.leases.size).toBe(0));
    await expect(replyPayment(context, id, { requestId: request.id, txHash: hash })).rejects.toThrow("already answered");
  });
  it("keeps uncertain signing locked and rejects a parallel Earn/payment wallet lease", async () => {
    const id = record(); await startPayment(context, id); const request = await pending(id);
    await expect(startPayment(context, record())).rejects.toThrow("Another Earn");
    await replyPayment(context, id, { requestId: request.id, cancelled: true });
    await vi.waitFor(async () => expect((await inspectPayment(context, id)).record.state).toBe("UNKNOWN"));
    expect(fake.leases.size).toBe(1);
    await expect(inspectPayment({ ...context, binding: "bob" }, id)).rejects.toThrow("unavailable");
  });
  it("does not consume an unverified provider or a changed policy", async () => {
    const id = record(); fake.records.get(id)!.proposal.executionEnabled = false;
    await expect(startPayment(context, id)).rejects.toThrow("Verified");
    fake.records.get(id)!.proposal.executionEnabled = true; fake.policy.mockReturnValue({ status: "BLOCKED" });
    await expect(startPayment(context, id)).rejects.toThrow("Fresh policy");
    expect(fake.leases.size).toBe(0);
  });
  it("rejects stale, mismatched, higher fee and missing receipt readiness before claim", async () => {
    const id = record(); const proposal = fake.records.get(id)!.proposal;
    fake.readiness.mockResolvedValue(false);
    await expect(startPayment(context, id)).rejects.toThrow("Verified");
    fake.readiness.mockResolvedValue(true);
    proposal.feeQuote!.expiresAt = new Date(Date.now()-1).toISOString();
    await expect(startPayment(context, id)).rejects.toThrow("FEE_QUOTE_NOT_AVAILABLE");
    proposal.feeQuote = fee(); proposal.feeReserve = { currency: "USDC", decimals: 6, minorUnits: "1" };
    await expect(startPayment(context, id)).rejects.toThrow("FEE_RESERVE_MISMATCH");
    proposal.feeReserve = fee().maxWalletDebit; fake.fee.mockResolvedValue({ ...fee(), gasLimit: "50001" });
    await expect(startPayment(context, id)).rejects.toThrow("FRESH_FEE_EXCEEDS_QUOTE");
    expect(fake.leases.size).toBe(0);
  });
  it("retains the lease when pre-signing cancellation cannot update the ledger", async () => {
    const id = record(); fake.current = null; fake.cancelFails = true;
    await expect(startPayment(context, id)).rejects.toThrow("CLAIMED_SESSION_UNAVAILABLE");
    expect(fake.leases.size).toBe(1);
  });
  it("releases a verified reverted EOA payment without confirming payment", async () => {
    const id = record(); fake.records.get(id)!.state = "UNKNOWN";
    fake.receipt.mockResolvedValue({ status: "reverted" });
    const recovered = await recheckPayment(context, id, hash);
    expect(recovered.record.state).toBe("FAILED"); expect(fake.revert).toHaveBeenCalled(); expect(fake.proof).not.toHaveBeenCalled();
  });
  it("cannot recover a hash with a different sender, payload or previously bound hash", async () => {
    const id = record(); const value = fake.records.get(id)!; value.state = "UNKNOWN";
    fake.transaction.mockResolvedValue({ from: "0x0000000000000000000000000000000000000002" });
    await expect(recheckPayment(context, id, hash)).rejects.toThrow("PAYMENT_TRANSACTION_MISMATCH");
    value.txHash = hash;
    await expect(recheckPayment(context, id, `0x${"2".repeat(64)}`)).rejects.toThrow("different submitted hash");
  });
  it("caps PIN execution, separates PIN acknowledgement from Circle submission and verifies the receipt", async () => {
    const id = record(); const ctx = { ...context, userToken: "mock-circle-session", wallet: { ...context.wallet, walletId: "circle-id", provider: "CIRCLE_USER_CONTROLLED" as const, accountType: "SCA" as const } };
    const proposal = fake.records.get(id)!.proposal; proposal.wallet = ctx.wallet; proposal.feeQuote = { ...fee(), provider: "CIRCLE_USER_CONTROLLED", source: "CIRCLE_UCW" };
    fake.fee.mockResolvedValue(proposal.feeQuote); fake.current = ctx;
    fake.circleCreate.mockResolvedValue({ data: { challengeId: "mock-challenge" } });
    fake.circleAdapter.mockImplementation(async (options) => ({ signing: { sign: async () => {
      await options.client.createUserTransactionContractExecutionChallenge({ walletId: ctx.wallet.walletId, contractAddress: "0x3600000000000000000000000000000000000000", callData: "0x1234", fee: { type: "level", config: { feeLevel: "MEDIUM" } } });
      options.onChallenge({ challengeId: "mock-challenge" });
      await new Promise<void>((resolve) => { fake.authorize = resolve; });
      options.onProgress({ stage: "transaction", status: "CONFIRMED", txHash: hash, transactionId: "circle-transaction-id" });
      return { txHash: hash };
    } } }));
    await startPayment(ctx, id); const request = await pending(id);
    expect(request.challengeId).toBe("mock-challenge"); expect(request.calls).toEqual([]);
    expect(fake.circleCreate).toHaveBeenCalledWith(expect.objectContaining({ fee: { type: "absolute", config: { gasLimit: "50000", maxFee: "20", priorityFee: "0" } } }));
    await expect(replyPayment(ctx, id, { requestId: request.id, txHash: hash })).rejects.toThrow("PIN replies");
    const ack = await replyPayment(ctx, id, { requestId: request.id, challengeApproved: true }); expect(ack.record.state).toBe("AWAITING_SIGNATURE"); expect(ack.pending).toBeNull();
    fake.authorize!();
    await vi.waitFor(async () => expect((await inspectPayment(ctx, id)).record.state).toBe("CONFIRMED"));
    expect(fake.proof).toHaveBeenCalled(); expect(fake.transaction).not.toHaveBeenCalled();
  });
  it("persists a passkey UserOperation once, independently of the later transaction hash", async () => {
    const id = record(); const ctx = { ...context, wallet: { ...context.wallet, provider: "CIRCLE_MODULAR" as const, accountType: "MSCA" as const } };
    const proposal = fake.records.get(id)!.proposal; proposal.wallet = ctx.wallet;
    proposal.feeReserve = { currency: "USDC", decimals: 6, minorUnits: "0" };
    proposal.feeQuote = { ...fee(), provider: "CIRCLE_MODULAR", source: "CIRCLE_MSCA", sponsorship: "VERIFIED", maxWalletDebit: proposal.feeReserve, userOperation: { sender: ctx.wallet.address, nonce: "0", callData: "0x1234", callGasLimit: "10000", verificationGasLimit: "10000", preVerificationGas: "10000", maxFeePerGas: "20000000000", maxPriorityFeePerGas: "0", paymaster: ARC_GAS_STATION_PAYMASTER, paymasterData: "0xabcd", paymasterVerificationGasLimit: "10000", paymasterPostOpGasLimit: "10000" } };
    fake.fee.mockResolvedValue(proposal.feeQuote); fake.current = ctx;
    await startPayment(ctx, id); const request = await pending(id);
    await replyPayment(ctx, id, { requestId: request.id, userOperationHash: hash });
    expect((await inspectPayment(ctx, id)).record.userOperationHash).toBe(hash);
    expect((await inspectPayment(ctx, id)).record.state).toBe("AWAITING_SIGNATURE");
    await expect(replyPayment(ctx, id, { requestId: request.id, userOperationHash: hash })).rejects.toThrow("already recorded");
    await replyPayment(ctx, id, { requestId: request.id, txHash: `0x${"2".repeat(64)}` });
    await vi.waitFor(async () => expect((await inspectPayment(ctx, id)).record.state).toBe("CONFIRMED"));
  });
});
