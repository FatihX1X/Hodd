// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";

const wallet = "0x00000000000000000000000000000000000000aa";
const recipient = "0x00000000000000000000000000000000000000bb";
const usdc = (minorUnits: string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits });
const fake = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("@/test/fake-supabase").fakeSupabase>,
  receipts: new Map<string, { status: "success" | "reverted"; blockNumber: bigint; gasUsed: bigint; effectiveGasPrice: bigint }>(),
  transactions: new Map<string, { from: string; to: string; input: string; value: bigint }>(),
  nonce: { latest: 4, pending: 4 }, claimError: null as string | null, policy: vi.fn(), finish: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("./admin", () => ({ paymentAdmin: () => fake.db }));
vi.mock("@/lib/execution/live-readiness", () => ({ assertLiveReady: vi.fn(async () => undefined), assertLiveAmount: vi.fn() }));
vi.mock("@/lib/earn/server-context", () => ({ earnServerContext: vi.fn(async () => current), assertEarnContextCurrent: vi.fn(async () => undefined) }));
vi.mock("./policy", () => ({ assessPayment: fake.policy, paymentRecipient: (value: string) => value }));
vi.mock("./fees", () => ({ quotePaymentFees: vi.fn(async () => ({ gasLimit: "50000", maxFeePerGasWei: "20000000000", priorityFeePerGasWei: "0" })) }));
vi.mock("@/lib/wallet/fee-quote", async (original) => ({ ...(await original<typeof import("@/lib/wallet/fee-quote")>()), assertFeeBinding: vi.fn((quote: unknown) => quote) }));
vi.mock("./receipts", () => ({ verifyPaymentReceipt: vi.fn(() => ({ blockNumber: "101", logIndex: 0, networkFee: usdc("1") })), verifyPaymentRevert: vi.fn(() => ({ status: "REVERTED" })) }));
vi.mock("./user-operation", () => ({ verifyPaymentUserOperation: vi.fn(), resolvePaymentUserOperation: vi.fn() }));
vi.mock("@/lib/wallet/modular-server", () => ({ modularReadClient: vi.fn() }));
vi.mock("@/lib/circle/user-wallet-server", () => ({ circleUserWalletClient: () => null }));
vi.mock("@/lib/earn/gateway", () => ({
  arcClient: {
    getChainId: vi.fn(async () => 5042002),
    getTransactionCount: vi.fn(async ({ blockTag }: { blockTag: "latest" | "pending" }) => fake.nonce[blockTag]),
    getTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => { const receipt = fake.receipts.get(hash); if (!receipt) throw new Error("not found"); return receipt; }),
    getTransaction: vi.fn(async ({ hash }: { hash: string }) => fake.transactions.get(hash)),
  },
  discoverAllowedVaults: vi.fn(), getEarnPosition: vi.fn(),
}));
vi.mock("./server", async (original) => ({ ...(await original<typeof import("./server")>()), freshPaymentWorkspace: vi.fn(async () => {
  const proposal = fake.db.tables.payment_proposals.find((row) => row.state === "AWAITING_SIGNATURE" || row.state === "REVIEW_REQUIRED") as { id: string; proposal: { amount: object; feeReserve: object } } | undefined;
  return { obligations: [{ id: "bill", revision: 1 }], pendingTransactions: usdc("0"), paymentReservations: proposal ? [{ proposalId: proposal.id, obligationId: "bill", amount: usdc("0"), feeReserve: usdc("0") }] : [] };
}) }));

import { advancePayment, claimTestSignerPayment, inspectPayment, recoverPayment, replyPayment, startPayment } from "./jobs";
import { transferCall } from "./server";

let current: Record<string, unknown>;
const hash = (digit: string) => `0x${digit.repeat(64)}`;
const connection = (provider = "INJECTED_METAMASK") => ({ provider, custody: "USER_CONTROLLED", accountType: provider === "CIRCLE_USER_CONTROLLED" ? "SCA" : "EOA", ...(provider === "CIRCLE_USER_CONTROLLED" ? { walletId: "w1" } : {}), chain: "ARC-TESTNET", chainId: 5042002, address: wallet, label: "MetaMask", connectedAt: "2026-10-09T00:00:00.000Z" });

function setup(provider?: string, expiresInMs = 300_000) {
  const id = randomUUID(); const userId = randomUUID();
  const proposal = { id, obligationId: "bill", obligationRevision: 1, scope: "TREASURY", wallet: connection(provider), recipientAddress: recipient, recipientLabel: "Vendor", amount: usdc("100000"), feeReserve: usdc("1000"), balanceAfter: usdc("1"), gasBudgetWei: "1000000000000000",
    feeQuote: { provider: provider ?? "INJECTED_METAMASK", walletAddress: wallet, chainId: 5042002, operationDigest: "digest", observedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 299_000).toISOString(), sponsorship: "NOT_ASSUMED", gasLimit: "50000", maxFeePerGasWei: "20000000000", priorityFeePerGasWei: "0", maxNativeFeeWei: "1000000000000000", maxWalletDebit: usdc("1000"), source: provider === "CIRCLE_USER_CONTROLLED" ? "CIRCLE_UCW" : "ARC_EOA" },
    policy: { status: "PASS", label: "Policy", reason: "ok" }, expiresAt: new Date(Date.now() + expiresInMs).toISOString(), startBlock: "100", executionEnabled: true, executionReason: "ok" };
  fake.db = fakeSupabase({ payment_proposals: [{ id, user_id: userId, scope: "TREASURY", binding: "binding-a", policy_digest: "policy-a", state: "REVIEW_REQUIRED", proposal, tx_hash: null, user_operation_hash: null, receipt: null, pending: null }] }, (name, params, tables) => {
    const row = tables.payment_proposals.find((item) => item.id === params.p_id)!;
    if (name === "hodd_claim_payment") {
      if (fake.claimError) return { data: null, error: { message: fake.claimError } };
      if (row.state !== "REVIEW_REQUIRED") return { data: null, error: { message: "proposal not executable" } };
      row.state = "AWAITING_SIGNATURE"; return { data: null, error: null };
    }
    if (name === "hodd_cancel_payment") { if (row.tx_hash || !["REVIEW_REQUIRED", "AWAITING_SIGNATURE"].includes(row.state as string)) return { data: null, error: { message: "cannot release" } }; row.state = params.p_state; return { data: null, error: null }; }
    if (name === "hodd_finish_payment") { fake.finish(params); row.state = "CONFIRMED"; row.tx_hash = params.p_hash; row.receipt = params.p_receipt; return { data: null, error: null }; }
    if (name === "hodd_fail_payment_receipt") { row.state = "FAILED"; return { data: null, error: null }; }
    if (name === "hodd_release_unsubmitted_payment") { if ((row.proposal as { expiresAt: string }).expiresAt > new Date().toISOString()) return { data: null, error: { message: "cannot release" } }; row.state = "EXPIRED"; row.release_proof = params.p_proof; return { data: null, error: null }; }
    return { data: null, error: { message: "unknown" } };
  });
  current = { userId, scope: "TREASURY", binding: "binding-a", policyDigest: "policy-a", wallet: connection(provider), client: fake.db, userToken: null };
  return { id, ctx: current as never };
}
const call = () => transferCall({ recipientAddress: recipient, amount: usdc("100000") });
function mine(txHash: string, status: "success" | "reverted" = "success", input = call().data) {
  fake.receipts.set(txHash, { status, blockNumber: 101n, gasUsed: 30_000n, effectiveGasPrice: 20_000_000_000n });
  fake.transactions.set(txHash, { from: wallet, to: call().to, input, value: 0n });
}
const state = (id: string) => fake.db.tables.payment_proposals.find((row) => row.id === id)!.state;

beforeEach(() => { vi.clearAllMocks(); fake.receipts.clear(); fake.transactions.clear(); fake.nonce = { latest: 4, pending: 4 }; fake.claimError = null; fake.policy.mockReturnValue({ status: "PASS" }); });

describe("stateless payment execution", () => {
  it("claims, exposes the exact transfer, and confirms only after a verified receipt", async () => {
    const { id, ctx } = setup();
    const started = await startPayment(ctx, "LOCAL_ENABLED", id);
    expect(started.record.state).toBe("AWAITING_SIGNATURE");
    expect(started.pending).toMatchObject({ calls: [call()], gasBudgetWei: "1000000000000000" });
    expect(fake.db.tables.payment_proposals[0].pending).toMatchObject({ nonce: "4" });
    mine(hash("1"));
    const done = await replyPayment(ctx, id, { requestId: started.pending!.id, txHash: hash("1") });
    expect(done.record.state).toBe("CONFIRMED"); expect(fake.finish).toHaveBeenCalledTimes(1);
  });

  it("stays SUBMITTED until mined, then confirms on status", async () => {
    const { id, ctx } = setup(); const started = await startPayment(ctx, "LOCAL_ENABLED", id);
    expect((await replyPayment(ctx, id, { requestId: started.pending!.id, txHash: hash("2") })).record.state).toBe("SUBMITTED");
    mine(hash("2"));
    expect((await advancePayment(ctx, id)).record.state).toBe("CONFIRMED");
  });

  it("answers each signature request once and never re-exposes it", async () => {
    const { id, ctx } = setup(); const started = await startPayment(ctx, "LOCAL_ENABLED", id);
    await replyPayment(ctx, id, { requestId: started.pending!.id, txHash: hash("3") });
    await expect(replyPayment(ctx, id, { requestId: started.pending!.id, txHash: hash("4") })).rejects.toMatchObject({ code: "REQUEST_ALREADY_ANSWERED" });
    expect((await inspectPayment(ctx, id)).pending).toBeNull();
  });

  it("releases a wallet-rejected request and holds an uncertain one", async () => {
    const a = setup(); const first = await startPayment(a.ctx, "LOCAL_ENABLED", a.id);
    await replyPayment(a.ctx, a.id, { requestId: first.pending!.id, cancelled: true });
    expect(state(a.id)).toBe("FAILED");
    const b = setup(); const second = await startPayment(b.ctx, "LOCAL_ENABLED", b.id);
    await replyPayment(b.ctx, b.id, { requestId: second.pending!.id, cancelled: true, uncertain: true });
    expect(state(b.id)).toBe("UNKNOWN");
  });

  it("lets the dev test signer claim its exact request once", async () => {
    const { id, ctx } = setup("TEST_SIGNER"); const started = await startPayment(ctx, "LOCAL_ENABLED", id);
    await expect(claimTestSignerPayment("binding-a", [call()])).resolves.toMatchObject({ call: call() });
    await expect(claimTestSignerPayment("binding-a", [call()])).rejects.toMatchObject({ code: "TEST_SIGNER_REQUEST_NOT_FOUND" });
    await replyPayment(ctx, id, { requestId: started.pending!.id, cancelled: true, uncertain: true });
    expect(state(id)).toBe("UNKNOWN");
  });

  it("treats an unclaimed test-signer request as never signed", async () => {
    const { id, ctx } = setup("TEST_SIGNER"); const started = await startPayment(ctx, "LOCAL_ENABLED", id);
    await replyPayment(ctx, id, { requestId: started.pending!.id, cancelled: true, uncertain: true });
    expect(state(id)).toBe("FAILED");
  });

  it("never auto-releases an expired request, and releases it only with a nonce proof and acknowledgement", async () => {
    const { id, ctx } = setup(undefined, 5_000); await startPayment(ctx, "LOCAL_ENABLED", id);
    const row = fake.db.tables.payment_proposals[0];
    (row.pending as { expiresAt: string }).expiresAt = new Date(Date.now() - 120_000).toISOString();
    (row.proposal as { expiresAt: string }).expiresAt = new Date(Date.now() - 120_000).toISOString();
    expect((await advancePayment(ctx, id)).record.state).toBe("UNKNOWN");
    await expect(recoverPayment(ctx, id, false)).rejects.toMatchObject({ code: "RECOVERY_NOT_PROVEN" });
    fake.nonce = { latest: 4, pending: 5 };
    await expect(recoverPayment(ctx, id, true)).rejects.toMatchObject({ code: "RECOVERY_NOT_PROVEN" });
    fake.nonce = { latest: 4, pending: 4 };
    expect((await recoverPayment(ctx, id, true)).record.state).toBe("EXPIRED");
  });

  it("reports a busy wallet without leaving a claim", async () => {
    const { id, ctx } = setup(); fake.claimError = "wallet busy";
    await expect(startPayment(ctx, "LOCAL_ENABLED", id)).rejects.toMatchObject({ code: "WALLET_BUSY" });
    expect(state(id)).toBe("REVIEW_REQUIRED");
  });

  it("releases the claim when the signing request cannot be prepared", async () => {
    const { id, ctx } = setup("CIRCLE_USER_CONTROLLED");
    await expect(startPayment(ctx, "LOCAL_ENABLED", id)).rejects.toMatchObject({ code: "PAYMENT_PREPARATION_FAILED" });
    expect(state(id)).toBe("FAILED");
  });

  it("holds a mined transaction that is not this transfer", async () => {
    const { id, ctx } = setup(); const started = await startPayment(ctx, "LOCAL_ENABLED", id);
    mine(hash("5"), "success", "0xdeadbeef");
    expect((await replyPayment(ctx, id, { requestId: started.pending!.id, txHash: hash("5") })).record.state).toBe("UNKNOWN");
    expect(fake.finish).not.toHaveBeenCalled();
  });

  it("refuses execution when the proposal was not enabled for this host", async () => {
    const { id, ctx } = setup(); (fake.db.tables.payment_proposals[0].proposal as { executionEnabled: boolean }).executionEnabled = false;
    await expect(startPayment(ctx, "LOCAL_ENABLED", id)).rejects.toMatchObject({ code: "EXECUTION_NOT_ENABLED" });
  });
});
