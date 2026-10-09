// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";
import type { EarnQuote } from "./models";

const wallet = "0x00000000000000000000000000000000000000aa";
const usdc = (minorUnits: string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits });
const fake = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("@/test/fake-supabase").fakeSupabase>,
  captures: [] as { stage: "APPROVAL" | "EARN"; call: { to: `0x${string}`; data: `0x${string}`; value: string } }[],
  captureError: null as Error | null,
  receipts: new Map<string, { status: "success" | "reverted"; blockNumber: bigint; gasUsed: bigint; effectiveGasPrice: bigint; transactionHash: string }>(),
  transactions: new Map<string, { from: string; to: string; input: string; value: bigint }>(),
  nonce: { latest: 7, pending: 7 },
  verifyEarn: vi.fn(), verifyApproval: vi.fn(), policy: vi.fn(), contextCurrent: vi.fn(), evidence: vi.fn(),
  userOperationReceipt: vi.fn(), msaNonce: 3n,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/payments/admin", () => ({ paymentAdmin: () => fake.db }));
vi.mock("@/lib/execution/live-readiness", () => ({ assertLiveReady: vi.fn(async () => undefined) }));
vi.mock("./capture", () => ({
  EarnCaptureError: class extends Error { constructor(public failure: object) { super("CAPTURE_FAILED"); } },
  captureNextEarnCall: vi.fn(async () => { if (fake.captureError) throw fake.captureError; const next = fake.captures.shift(); if (!next) throw new Error("no capture"); return next; }),
}));
vi.mock("./router", () => ({ validateEarnCall: vi.fn((call: { data: string }) => ({ stage: call.data.startsWith("0x3950") ? "APPROVAL" : "EARN", deadline: BigInt(Math.floor(Date.now() / 1000) + 600) })) }));
vi.mock("./gateway", () => ({
  arcClient: {
    getBlockNumber: vi.fn(async () => 100n), getGasPrice: vi.fn(async () => 20_000_000_000n), estimateGas: vi.fn(async () => 60_000n),
    getTransactionCount: vi.fn(async ({ blockTag }: { blockTag: "latest" | "pending" }) => fake.nonce[blockTag]),
    readContract: vi.fn(async () => 0n),
    getTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => { const receipt = fake.receipts.get(hash); if (!receipt) throw new Error("not found"); return receipt; }),
    getTransaction: vi.fn(async ({ hash }: { hash: string }) => fake.transactions.get(hash)),
  },
  getEarnPosition: vi.fn(async () => ({ walletAddress: "0x00000000000000000000000000000000000000aa", vaultAddress: "0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88", vaultName: "Vault", currentBalance: { currency: "USDC", decimals: 6, minorUnits: "500000" }, maxWithdrawable: { currency: "USDC", decimals: 6, minorUnits: "500000" }, redeemable: { currency: "USDC", decimals: 6, minorUnits: "500000" }, liquidityStatus: "READY", shares: "0.49", apyBps: 400, pnl: { status: "PENDING" }, observedAt: new Date().toISOString() })),
}));
vi.mock("./server-quotes", () => ({ freshEarnInputs: vi.fn(async () => ({ vault: { earnKitWarnings: [], warnings: [] }, positions: [], position: { redeemable: usdc("5000000") }, workspace: { liquidUsdc: usdc("100000000") } })) }));
vi.mock("./server-context", () => ({ assertEarnContextCurrent: fake.contextCurrent }));
vi.mock("./server-policy", () => ({ assessEarnOperation: fake.policy }));
vi.mock("./receipts", () => ({ verifyEarnReceipt: fake.verifyEarn, verifyApprovalReceipt: fake.verifyApproval }));
vi.mock("./provider-evidence", () => ({ recordEarnEvidence: fake.evidence }));
vi.mock("@/lib/wallet/modular-server", () => ({ modularReadClient: vi.fn(async () => ({ account: { getNonce: async () => fake.msaNonce }, bundler: { getUserOperationReceipt: fake.userOperationReceipt } })) }));
vi.mock("@/lib/circle/user-wallet-server", () => ({ circleUserWalletClient: () => null }));

import { advanceEarnExecution, startEarnExecution, claimTestSignerEarnRequest } from "./executions";

const approvalCall = { to: "0x3600000000000000000000000000000000000000" as const, data: "0x39509351aa" as `0x${string}`, value: "0" };
const earnCall = { to: "0xBBD70b01a1CAbc96d5b7b129Ae1AAabdf50dd40b" as const, data: "0x1234abcd" as `0x${string}`, value: "0" };
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const quote = (id: string): EarnQuote => ({ quoteId: id, operation: "DEPOSIT", walletAddress: wallet, vaultAddress: "0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88", vaultName: "Vault", amount: usdc("500000"), expectedShares: "1", sharesToRedeem: null, maxWithdrawable: null, fees: usdc("30000"),
  gasFees: [{ name: "Approve", amount: usdc("5000"), gasLimit: "100000", maxGasPriceWei: "40000000000" }, { name: "Deposit", amount: usdc("25000"), gasLimit: "500000", maxGasPriceWei: "40000000000" }],
  warnings: [], policy: { status: "PASS", label: "Policy", reason: "ok" }, expiresAt: new Date(Date.now() + 300_000).toISOString(), requiresWarningAcknowledgement: false });
const connection = (provider = "INJECTED_RABBY", accountType = "EOA") => ({ provider, custody: "USER_CONTROLLED", accountType, chain: "ARC-TESTNET", chainId: 5042002, address: wallet, label: "Rabby", connectedAt: "2026-10-09T00:00:00.000Z", ...(provider === "CIRCLE_MODULAR" ? { passkey: { id: "cred", publicKey: `0x04${"1".repeat(128)}` } } : {}) });
const context = (provider?: string, accountType?: string) => ({ userId: randomUUID(), scope: "TREASURY", wallet: connection(provider, accountType), binding: "binding-a", policyDigest: "policy-a", client: {}, userToken: null }) as never;

function setup(provider?: string, accountType?: string) {
  const ctx = context(provider, accountType) as { userId: string };
  const id = randomUUID();
  fake.db = fakeSupabase({ earn_quotes: [{ id, user_id: ctx.userId, scope: "TREASURY", wallet_address: wallet, binding: "binding-a", policy_digest: "policy-a", quote: quote(id), expires_at: new Date(Date.now() + 300_000).toISOString(), consumed_at: null }], earn_executions: [], earn_execution_receipts: [] },
    (name, params, tables) => {
      if (name !== "hodd_start_earn_execution") return { data: null, error: { message: "unknown" } };
      const stored = tables.earn_quotes.find((row) => row.id === params.p_quote && !row.consumed_at);
      if (!stored) return { data: null, error: { message: "quote not available" } };
      stored.consumed_at = new Date().toISOString();
      tables.earn_executions.push({ id: stored.id, user_id: params.p_user, scope: params.p_scope, wallet_address: wallet, wallet: params.p_wallet, binding: params.p_binding, policy_digest: params.p_policy_digest, quote: stored.quote, state: "PREPARING", approvals: 0, started_block: params.p_started_block, gas_spent_wei: "0", pending: null, events: [{ stage: "USER_CONFIRMED" }], result: null, failure: null, version: 0 });
      return { data: null, error: null };
    }, { earn_execution_receipts: [["tx_hash", "wallet_address"]] });
  return { ctx: ctx as never, id };
}
function mine(txHash: string, call: { to: string; data: string }, status: "success" | "reverted" = "success", block = 101n) {
  fake.receipts.set(txHash, { status, blockNumber: block, gasUsed: 50_000n, effectiveGasPrice: 20_000_000_000n, transactionHash: txHash });
  fake.transactions.set(txHash, { from: wallet, to: call.to, input: call.data, value: 0n });
}
const row = (id: string) => fake.db.tables.earn_executions.find((item) => item.id === id) as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks(); fake.captures = []; fake.captureError = null; fake.receipts.clear(); fake.transactions.clear(); fake.nonce = { latest: 7, pending: 7 };
  fake.policy.mockReturnValue({ status: "PASS" }); fake.contextCurrent.mockResolvedValue(undefined); fake.evidence.mockResolvedValue(undefined);
});

describe("stateless Earn execution", () => {
  it("runs approval then deposit across separate requests and completes on verified receipts", async () => {
    const { ctx, id } = setup(); fake.captures.push({ stage: "APPROVAL", call: approvalCall }, { stage: "EARN", call: earnCall });
    const started = await startEarnExecution(ctx, "LOCAL_ENABLED", id, false);
    expect(started.failure).toBeNull(); expect(started.state).toBe("AWAITING_SIGNATURE");
    expect(started.pending).toMatchObject({ stage: "APPROVAL", calls: [approvalCall], gasCeiling: { gasLimit: "100000", gasPriceWei: "40000000000" } });
    expect(row(id).pending).toMatchObject({ nonce: "7" });
    mine(hash("1"), approvalCall);
    const afterApproval = await advanceEarnExecution(ctx, "LOCAL_ENABLED", id, { requestId: started.pending!.id, txHash: hash("1") });
    expect(afterApproval.state).toBe("AWAITING_SIGNATURE");
    expect(afterApproval.pending).toMatchObject({ stage: "EARN", calls: [earnCall] });
    expect(afterApproval.events.map((event) => event.stage)).toContain("APPROVAL_CONFIRMED");
    mine(hash("2"), earnCall);
    const done = await advanceEarnExecution(ctx, "LOCAL_ENABLED", id, { requestId: afterApproval.pending!.id, txHash: hash("2") });
    expect(done.state).toBe("COMPLETE");
    expect(done.result).toMatchObject({ txHash: hash("2"), status: "COMPLETE" });
    expect(fake.verifyApproval).toHaveBeenCalledTimes(1); expect(fake.verifyEarn).toHaveBeenCalledTimes(1);
    expect(fake.db.tables.earn_execution_receipts).toHaveLength(2);
  });

  it("consumes a quote once", async () => {
    const { ctx, id } = setup(); fake.captures.push({ stage: "EARN", call: earnCall });
    await startEarnExecution(ctx, "LOCAL_ENABLED", id, false);
    await expect(startEarnExecution(ctx, "LOCAL_ENABLED", id, false)).rejects.toMatchObject({ code: "QUOTE_NOT_AVAILABLE" });
  });

  it("keeps SUBMITTED until the receipt exists, without guessing", async () => {
    const { ctx, id } = setup(); fake.captures.push({ stage: "EARN", call: earnCall });
    const started = await startEarnExecution(ctx, "LOCAL_ENABLED", id, false);
    const submitted = await advanceEarnExecution(ctx, "LOCAL_ENABLED", id, { requestId: started.pending!.id, txHash: hash("3") });
    expect(submitted.state).toBe("SUBMITTED"); expect(submitted.pending).toBeNull();
    mine(hash("3"), earnCall);
    expect((await advanceEarnExecution(ctx, "LOCAL_ENABLED", id)).state).toBe("COMPLETE");
  });

  it("rejects a second answer to the same request", async () => {
    const { ctx, id } = setup(); fake.captures.push({ stage: "EARN", call: earnCall });
    const started = await startEarnExecution(ctx, "LOCAL_ENABLED", id, false);
    await advanceEarnExecution(ctx, "LOCAL_ENABLED", id, { requestId: started.pending!.id, txHash: hash("4") });
    await expect(advanceEarnExecution(ctx, "LOCAL_ENABLED", id, { requestId: started.pending!.id, txHash: hash("5") })).rejects.toMatchObject({ code: "SIGNATURE_REQUEST_NOT_AVAILABLE" });
  });

  it("closes a rejected signature as FAILED and an uncertain one as UNKNOWN", async () => {
    const first = setup(); fake.captures.push({ stage: "EARN", call: earnCall });
    const a = await startEarnExecution(first.ctx, "LOCAL_ENABLED", first.id, false);
    expect((await advanceEarnExecution(first.ctx, "LOCAL_ENABLED", first.id, { requestId: a.pending!.id, cancelled: true })).state).toBe("FAILED");
    const second = setup(); fake.captures.push({ stage: "EARN", call: earnCall });
    const b = await startEarnExecution(second.ctx, "LOCAL_ENABLED", second.id, false);
    expect((await advanceEarnExecution(second.ctx, "LOCAL_ENABLED", second.id, { requestId: b.pending!.id, cancelled: true, uncertain: true })).state).toBe("UNKNOWN");
  });

  it("treats an unclaimed dev test-signer request as never signed", async () => {
    const { ctx, id } = setup("TEST_SIGNER"); fake.captures.push({ stage: "EARN", call: earnCall });
    const started = await startEarnExecution(ctx, "LOCAL_ENABLED", id, false);
    expect((await advanceEarnExecution(ctx, "LOCAL_ENABLED", id, { requestId: started.pending!.id, cancelled: true, uncertain: true })).state).toBe("FAILED");
  });

  it("claims a pending test-signer request exactly once", async () => {
    const { ctx, id } = setup("TEST_SIGNER"); fake.captures.push({ stage: "EARN", call: earnCall });
    const started = await startEarnExecution(ctx, "LOCAL_ENABLED", id, false);
    const ceiling = started.pending!.gasCeiling!;
    await expect(claimTestSignerEarnRequest("binding-a", earnCall, ceiling)).resolves.toMatchObject({ call: earnCall });
    await expect(claimTestSignerEarnRequest("binding-a", earnCall, ceiling)).rejects.toMatchObject({ code: "TEST_SIGNER_REQUEST_NOT_FOUND" });
    await expect(claimTestSignerEarnRequest("binding-b", earnCall, ceiling)).rejects.toMatchObject({ code: "TEST_SIGNER_REQUEST_NOT_FOUND" });
  });

  it("holds a mismatching mined transaction as UNKNOWN", async () => {
    const { ctx, id } = setup(); fake.captures.push({ stage: "EARN", call: earnCall });
    const started = await startEarnExecution(ctx, "LOCAL_ENABLED", id, false);
    mine(hash("6"), { to: earnCall.to, data: "0xdeadbeef" });
    const result = await advanceEarnExecution(ctx, "LOCAL_ENABLED", id, { requestId: started.pending!.id, txHash: hash("6") });
    expect(result.state).toBe("UNKNOWN"); expect(result.failure?.code).toBe("TRANSACTION_PAYLOAD_MISMATCH");
  });

  it("fails a reverted router call and never reuses a receipt for two steps", async () => {
    const first = setup(); fake.captures.push({ stage: "EARN", call: earnCall });
    const a = await startEarnExecution(first.ctx, "LOCAL_ENABLED", first.id, false);
    mine(hash("7"), earnCall, "reverted");
    expect((await advanceEarnExecution(first.ctx, "LOCAL_ENABLED", first.id, { requestId: a.pending!.id, txHash: hash("7") })).state).toBe("FAILED");
    const second = setup(); fake.captures.push({ stage: "APPROVAL", call: approvalCall }, { stage: "EARN", call: approvalCall });
    const b = await startEarnExecution(second.ctx, "LOCAL_ENABLED", second.id, false);
    mine(hash("8"), approvalCall);
    const c = await advanceEarnExecution(second.ctx, "LOCAL_ENABLED", second.id, { requestId: b.pending!.id, txHash: hash("8") });
    const reused = await advanceEarnExecution(second.ctx, "LOCAL_ENABLED", second.id, { requestId: c.pending!.id, txHash: hash("8") });
    expect(reused.state).toBe("UNKNOWN");
  });

  it("closes an expired request as FAILED only while the nonce is unchanged", async () => {
    const first = setup(); fake.captures.push({ stage: "EARN", call: earnCall });
    await startEarnExecution(first.ctx, "LOCAL_ENABLED", first.id, false);
    (row(first.id).pending as Record<string, unknown>).expiresAt = new Date(Date.now() - 120_000).toISOString();
    expect((await advanceEarnExecution(first.ctx, "LOCAL_ENABLED", first.id)).state).toBe("FAILED");
    const second = setup(); fake.captures.push({ stage: "EARN", call: earnCall });
    await startEarnExecution(second.ctx, "LOCAL_ENABLED", second.id, false);
    (row(second.id).pending as Record<string, unknown>).expiresAt = new Date(Date.now() - 120_000).toISOString();
    fake.nonce = { latest: 7, pending: 8 };
    expect((await advanceEarnExecution(second.ctx, "LOCAL_ENABLED", second.id)).state).toBe("UNKNOWN");
  });

  it("recovers UNKNOWN only with a verifiable hash or an unchanged nonce", async () => {
    const { ctx, id } = setup(); fake.captures.push({ stage: "EARN", call: earnCall });
    const started = await startEarnExecution(ctx, "LOCAL_ENABLED", id, false);
    await advanceEarnExecution(ctx, "LOCAL_ENABLED", id, { requestId: started.pending!.id, cancelled: true, uncertain: true });
    fake.nonce = { latest: 8, pending: 8 };
    await expect(advanceEarnExecution(ctx, "LOCAL_ENABLED", id, undefined, { acknowledgeNoPendingTransaction: true })).rejects.toMatchObject({ code: "RECOVERY_NOT_PROVEN" });
    // Nothing was reported, so a bare recheck has no evidence to verify.
    await expect(advanceEarnExecution(ctx, "LOCAL_ENABLED", id, undefined, {})).rejects.toMatchObject({ code: "RECOVERY_NOT_PROVEN" });
    mine(hash("9"), earnCall);
    expect((await advanceEarnExecution(ctx, "LOCAL_ENABLED", id, undefined, { candidateTxHash: hash("9") })).state).toBe("COMPLETE");
  });

  it("rechecks the reported transaction from a reconnected session without signing for it", async () => {
    const { ctx, id } = setup(); fake.captures.push({ stage: "EARN", call: earnCall });
    const started = await startEarnExecution(ctx, "LOCAL_ENABLED", id, false);
    mine(hash("c"), earnCall);
    fake.verifyEarn.mockImplementationOnce(() => { throw new Error("EARN_RECEIPT_NOT_VERIFIED"); });
    expect((await advanceEarnExecution(ctx, "LOCAL_ENABLED", id, { requestId: started.pending!.id, txHash: hash("c") })).state).toBe("UNKNOWN");
    const reconnected = { ...(ctx as object), binding: "binding-b" } as never;
    await expect(advanceEarnExecution(reconnected, "LOCAL_ENABLED", id, { requestId: started.pending!.id, txHash: hash("c") }, {})).rejects.toMatchObject({ code: "EXECUTION_NOT_FOUND" });
    const settled = await advanceEarnExecution(reconnected, "LOCAL_ENABLED", id, undefined, {});
    expect(settled.state).toBe("COMPLETE"); expect(settled.failure).toBeNull();
    expect(settled.events.map((event) => event.stage)).toContain("RECHECK_REQUESTED");
    expect(fake.db.tables.earn_execution_receipts).toHaveLength(1);
  });

  it("lets a reconnected session close a preparing execution but never prepare its next call", async () => {
    const { ctx, id } = setup(); fake.captures.push({ stage: "APPROVAL", call: approvalCall }, { stage: "EARN", call: earnCall });
    const started = await startEarnExecution(ctx, "LOCAL_ENABLED", id, false);
    mine(hash("d"), approvalCall);
    // Approval is confirmed by the original session, but its next step is not prepared yet.
    Object.assign(row(id), { state: "SUBMITTED", pending: { ...(row(id).pending as object), txHash: hash("d") } });
    const reconnected = { ...(ctx as object), binding: "binding-b" } as never;
    const checked = await advanceEarnExecution(reconnected, "LOCAL_ENABLED", id, undefined, {});
    expect(checked.state).toBe("PREPARING"); expect(checked.pending).toBeNull(); expect(started.pending!.stage).toBe("APPROVAL");
    expect((await advanceEarnExecution(reconnected, "LOCAL_ENABLED", id, undefined, { acknowledgeNoPendingTransaction: true })).state).toBe("FAILED");
  });

  it("fails cleanly when Earn Kit cannot produce a call, and when policy changed", async () => {
    const first = setup(); fake.captureError = Object.assign(new Error("CAPTURE_FAILED"), { failure: { code: "SDK_FAILURE", stage: "CAPTURE" } });
    const { EarnCaptureError } = await import("./capture");
    fake.captureError = new (EarnCaptureError as unknown as new (failure: object) => Error)({ code: "SDK_FAILURE", stage: "CAPTURE" });
    const a = await startEarnExecution(first.ctx, "LOCAL_ENABLED", first.id, false);
    expect(a.state).toBe("FAILED"); expect(a.failure).toMatchObject({ stage: "CAPTURE" });
    fake.captureError = null;
    const second = setup(); fake.captures.push({ stage: "EARN", call: earnCall });
    fake.contextCurrent.mockRejectedValueOnce(new Error("SESSION_OR_WORKSPACE_CHANGED"));
    const b = await startEarnExecution(second.ctx, "LOCAL_ENABLED", second.id, false);
    expect(b.state).toBe("FAILED"); expect(b.failure?.code).toBe("SESSION_OR_WORKSPACE_CHANGED");
  });

  it("does not expose another session's execution", async () => {
    const { ctx, id } = setup(); fake.captures.push({ stage: "EARN", call: earnCall });
    await startEarnExecution(ctx, "LOCAL_ENABLED", id, false);
    await expect(advanceEarnExecution({ ...(ctx as object), binding: "binding-b" } as never, "LOCAL_ENABLED", id)).rejects.toMatchObject({ code: "EXECUTION_NOT_FOUND" });
  });

  it("resolves a passkey UserOperation to its mined transaction", async () => {
    const { ctx, id } = setup("CIRCLE_MODULAR", "MSCA"); fake.captures.push({ stage: "EARN", call: earnCall });
    const started = await startEarnExecution(ctx, "LOCAL_ENABLED", id, false);
    expect(row(id).pending).toMatchObject({ nonce: "3" });
    fake.userOperationReceipt.mockResolvedValue({ receipt: { transactionHash: hash("a") } });
    fake.receipts.set(hash("a"), { status: "success", blockNumber: 101n, gasUsed: 1n, effectiveGasPrice: 1n, transactionHash: hash("a") });
    const result = await advanceEarnExecution(ctx, "LOCAL_ENABLED", id, { requestId: started.pending!.id, userOperationHash: hash("b") });
    expect(result.state).toBe("COMPLETE");
  });
});
