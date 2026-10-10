// @vitest-environment node
import { randomUUID } from "node:crypto";
import { privateKeyToAccount } from "viem/accounts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "@/test/fake-supabase";

const account = privateKeyToAccount(`0x${"22".repeat(32)}`);
const recipient = "0x62dCe01b1a7B9a6f592f148d305E0D5751478386";
const usdc = (minorUnits: string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits });
const mintHash = `0x${"c".repeat(64)}`;
const fake = vi.hoisted(() => ({
  db: null as unknown as ReturnType<typeof import("@/test/fake-supabase").fakeSupabase>,
  balance: 10_000_000n, submit: vi.fn(), status: vi.fn(), verifyMint: vi.fn(), findMint: vi.fn(), finish: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/payments/admin", () => ({ paymentAdmin: () => fake.db }));
vi.mock("@/lib/execution/live-readiness", () => ({ assertLiveReady: vi.fn(async () => undefined), assertLiveAmount: vi.fn() }));
vi.mock("@/lib/earn/gateway", () => ({ arcClient: { getBlockNumber: vi.fn(async () => 100n) }, discoverAllowedVaults: vi.fn(), getEarnPosition: vi.fn() }));
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  estimateForwardedTransfer: vi.fn(async (spec: unknown) => ({ intent: { maxBlockHeight: "999999", maxFee: "30000", spec }, feeMinor: 30_000n, forwardingFeeMinor: 25_000n })),
  gatewayBalances: vi.fn(async () => new Map([[6, fake.balance]])),
  submitForwardedTransfer: fake.submit, gatewayTransferStatus: fake.status,
}));
vi.mock("./receipts", () => ({ verifyGatewayMint: fake.verifyMint, findGatewayMint: fake.findMint }));

import { GatewayApiError } from "./api";
import { advanceGatewayPayment, assessGatewayPayment, confirmGatewayPayment, recoverGatewayPayment, reviewGatewayPayment, signGatewayPayment } from "./payments";
import { burnIntentTypedData, type BurnIntent } from "./intent";

const obligation = { id: "bill", title: "Vendor", category: "VENDOR" as const, amount: usdc("1000000"), dueAt: "2026-10-20T00:00:00.000Z", recipient: "Vendor", priority: "NORMAL" as const, status: "UPCOMING" as const, description: "", recipientAddress: recipient, revision: 1 };
const wallet = { provider: "INJECTED_RABBY", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address: account.address, label: "Rabby", connectedAt: "2026-10-10T00:00:00.000Z" };
let context: Record<string, unknown>;
type Proposal = { id: string; state: string; tx_hash: string | null; provider_transaction_id?: string | null; pending: { id: string; intent: BurnIntent; signature?: string } | null };

beforeEach(() => {
  fake.balance = 10_000_000n; fake.submit.mockReset(); fake.status.mockReset(); fake.verifyMint.mockReset(); fake.findMint.mockReset(); fake.finish.mockReset();
  const userId = randomUUID();
  fake.db = fakeSupabase({ payment_obligations: [{ user_id: userId, scope: "TREASURY", id: "bill", revision: 1, body: obligation }], payment_proposals: [] }, (name, params, tables) => {
    const row = tables.payment_proposals.find((item) => item.id === params.p_id) as Proposal | undefined;
    if (!row) return { data: null, error: { message: "missing" } };
    if (name === "hodd_claim_payment") { if (row.state !== "REVIEW_REQUIRED") return { data: null, error: { message: "proposal not executable" } }; row.state = "AWAITING_SIGNATURE"; return { data: null, error: null }; }
    if (name === "hodd_cancel_payment") { if (row.tx_hash || !["REVIEW_REQUIRED", "AWAITING_SIGNATURE"].includes(row.state)) return { data: null, error: { message: "cannot release" } }; row.state = params.p_state as string; return { data: null, error: null }; }
    if (name === "hodd_finish_payment") { fake.finish(params); row.state = "CONFIRMED"; row.tx_hash = params.p_hash as string; return { data: null, error: null }; }
    if (name === "hodd_release_unsubmitted_payment") { if (!["AWAITING_SIGNATURE", "UNKNOWN"].includes(row.state) || row.tx_hash) return { data: null, error: { message: "cannot release" } }; row.state = "EXPIRED"; return { data: null, error: null }; }
    return { data: null, error: { message: "unknown rpc" } };
  });
  context = { client: fake.db, userId, scope: "TREASURY", wallet, binding: "binding-a", policyDigest: "policy-a", workspace: { obligations: [obligation], policy: {}, pendingTransactions: usdc("0"), paymentReservations: [] } };
});

const row = () => fake.db.tables.payment_proposals[0] as unknown as Proposal;
async function reviewAndConfirm() {
  const reviewed = await reviewGatewayPayment(context as never, "LOCAL_ENABLED", "bill", "Base_Sepolia");
  // Column defaults the real table applies on insert.
  Object.assign(row(), { state: "REVIEW_REQUIRED", tx_hash: null, user_operation_hash: null, receipt: null, pending: null, provider_transaction_id: null });
  const confirmed = await confirmGatewayPayment(context as never, "LOCAL_ENABLED", reviewed.record.id);
  return { reviewed, confirmed };
}

describe("cross-chain obligation payment", () => {
  it("mints the exact amount to the obligation recipient and marks PAID only after the verified Arc mint", async () => {
    const { reviewed, confirmed } = await reviewAndConfirm();
    expect(reviewed.record.proposal).toMatchObject({ rail: "GATEWAY", recipientAddress: recipient, feeReserve: usdc("0"), policy: { status: "PASS" } });
    expect(reviewed.record.proposal.gateway?.intent.spec.destinationDomain).toBe(26);
    const sign = confirmed.gateway.sign!;
    expect(sign.intent.spec.value).toBe("1000000");
    fake.submit.mockResolvedValue("6f2f0e64-55c1-4a8b-9c56-4f0b1d1e0b11");
    fake.status.mockResolvedValue({ status: "confirmed", transactionHash: mintHash });
    fake.verifyMint.mockResolvedValue({ blockNumber: "120", logIndex: 1, networkFee: usdc("0") });
    const signature = await account.signTypedData(burnIntentTypedData(sign.intent));
    const done = await signGatewayPayment(context as never, reviewed.record.id, sign.id, signature);
    expect(done.record.state).toBe("CONFIRMED");
    expect(fake.verifyMint).toHaveBeenCalledWith(mintHash, { recipient, valueMinor: 1_000_000n, afterBlock: 100n });
    expect(fake.finish).toHaveBeenCalledWith(expect.objectContaining({ p_hash: mintHash, p_receipt: { blockNumber: "120", logIndex: 1, networkFee: usdc("0") } }));
    await expect(signGatewayPayment(context as never, reviewed.record.id, sign.id, signature)).rejects.toThrow(/already answered/);
    expect(fake.submit).toHaveBeenCalledTimes(1);
  });

  it("refuses a signature from another key and never submits it", async () => {
    const { reviewed, confirmed } = await reviewAndConfirm();
    const other = privateKeyToAccount(`0x${"33".repeat(32)}`);
    const signature = await other.signTypedData(burnIntentTypedData(confirmed.gateway.sign!.intent));
    await expect(signGatewayPayment(context as never, reviewed.record.id, confirmed.gateway.sign!.id, signature)).rejects.toThrow(/signature/);
    expect(fake.submit).not.toHaveBeenCalled();
    expect(row().state).toBe("AWAITING_SIGNATURE");
  });

  it("releases the bill when the wallet rejects, and when Gateway definitively refuses", async () => {
    const first = await reviewAndConfirm();
    await signGatewayPayment(context as never, first.reviewed.record.id, first.confirmed.gateway.sign!.id, null);
    expect(row().state).toBe("FAILED");
    fake.db.tables.payment_proposals.length = 0;
    const second = await reviewAndConfirm();
    fake.submit.mockRejectedValue(new GatewayApiError("GATEWAY_REJECTED", "Circle Gateway refused the request: bad", 409, true));
    const signature = await account.signTypedData(burnIntentTypedData(second.confirmed.gateway.sign!.intent));
    await expect(signGatewayPayment(context as never, second.reviewed.record.id, second.confirmed.gateway.sign!.id, signature)).rejects.toThrow(/Nothing was sent/);
    expect(row().state).toBe("FAILED");
  });

  it("keeps an ambiguous submission locked, and recovers it by mint lookup without a new signature", async () => {
    const { reviewed, confirmed } = await reviewAndConfirm();
    fake.submit.mockRejectedValue(new GatewayApiError("GATEWAY_UNREACHABLE", "no answer"));
    fake.findMint.mockResolvedValue(null);
    const signature = await account.signTypedData(burnIntentTypedData(confirmed.gateway.sign!.intent));
    const held = await signGatewayPayment(context as never, reviewed.record.id, confirmed.gateway.sign!.id, signature);
    expect(held.record.state).toBe("UNKNOWN");
    await expect(recoverGatewayPayment(context as never, reviewed.record.id)).rejects.toThrow(/cannot prove/);
    fake.findMint.mockResolvedValue({ hash: mintHash, evidence: {} });
    fake.verifyMint.mockResolvedValue({ blockNumber: "130", logIndex: 0, networkFee: usdc("0") });
    const settled = await advanceGatewayPayment(context as never, reviewed.record.id);
    expect(settled.record.state).toBe("CONFIRMED");
  });

  it("releases a submitted transfer only when Gateway reports it expired and Arc has no mint", async () => {
    const { reviewed, confirmed } = await reviewAndConfirm();
    fake.submit.mockResolvedValue("6f2f0e64-55c1-4a8b-9c56-4f0b1d1e0b12");
    fake.status.mockResolvedValue({ status: "pending" });
    const signature = await account.signTypedData(burnIntentTypedData(confirmed.gateway.sign!.intent));
    expect((await signGatewayPayment(context as never, reviewed.record.id, confirmed.gateway.sign!.id, signature)).record.state).toBe("SUBMITTED");
    await expect(recoverGatewayPayment(context as never, reviewed.record.id)).rejects.toThrow(/cannot prove/);
    fake.status.mockResolvedValue({ status: "expired" }); fake.findMint.mockResolvedValue(null);
    expect((await recoverGatewayPayment(context as never, reviewed.record.id)).record.state).toBe("EXPIRED");
  });

  it("blocks review when the Gateway balance cannot cover amount plus fees", async () => {
    fake.balance = 1_020_000n;
    const reviewed = await reviewGatewayPayment(context as never, "LOCAL_ENABLED", "bill", "Base_Sepolia");
    expect(reviewed.record.proposal.policy.status).toBe("BLOCKED");
    expect(assessGatewayPayment(context.workspace as never, { ...obligation, status: "PAID" }, 9n ** 9n, 1n, "X").status).toBe("BLOCKED");
  });

  it("refuses smart-account wallets", async () => {
    context.wallet = { ...wallet, provider: "CIRCLE_MODULAR", accountType: "MSCA" };
    await expect(reviewGatewayPayment(context as never, "LOCAL_ENABLED", "bill", "Base_Sepolia")).rejects.toThrow(/MetaMask or Rabby/);
  });
});
