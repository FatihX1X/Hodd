// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace, usdc } from "@/lib/treasury/fixtures";
import type { PaymentRecord } from "./models";
import type { PaymentContext } from "./server";

const fake = vi.hoisted(() => ({ records: new Map<string, PaymentRecord>(), leases: new Set<string>(), current: null as unknown, policy: vi.fn(), proof: vi.fn(), receipt: vi.fn(), transaction: vi.fn(), claimed: false }));
vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", async (importOriginal) => ({ ...(await importOriginal<typeof import("node:fs/promises")>()), mkdir: vi.fn(), unlink: vi.fn(async (path: string) => fake.leases.delete(path)), writeFile: vi.fn(async (path: string) => { if (fake.leases.has(path)) throw new Error("exists"); fake.leases.add(path); }) }));
vi.mock("@/lib/earn/durable-quotes", () => ({ digest: (value: string) => value }));
vi.mock("@/lib/earn/server-context", () => ({ earnServerContext: vi.fn(async () => fake.current) }));
vi.mock("./policy", () => ({ assessPayment: fake.policy }));
vi.mock("./receipts", () => ({ verifyPaymentReceipt: fake.proof }));
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
  if (name === "hodd_claim_payment") {
    if (record.state !== "REVIEW_REQUIRED") return { error: {} };
    record.state = "AWAITING_SIGNATURE"; fake.claimed = true;
  } else if (name === "hodd_finish_payment") { record.state = "CONFIRMED"; record.txHash = params.p_hash; }
  else record.state = "FAILED";
  return { error: null };
}, from: () => ({ update: (values: Partial<PaymentRecord> & { tx_hash?: string }) => {
  let id = "";
  const query = { eq: (key: string, value: string) => { if (key === "id") id = value; return query; }, in: () => query, then: (resolve: (value: object) => void) => { const record = fake.records.get(id)!; Object.assign(record, values, values.tx_hash ? { txHash: values.tx_hash } : {}); resolve({ error: null }); } };
  return query;
} }) }) }));
import { inspectPayment, replyPayment, startPayment } from "./jobs";
const hash = `0x${"1".repeat(64)}`;
const context = { binding: "alice", policyDigest: "policy", scope: "TREASURY", userId: "alice", wallet: { provider: "INJECTED_METAMASK", accountType: "EOA", address: "0x0000000000000000000000000000000000000001" } } as PaymentContext;
function record() {
  const id = randomUUID();
  fake.records.set(id, { id, state: "REVIEW_REQUIRED", txHash: null, userOperationHash: null, receipt: null, proposal: { id, obligationId: "obl-payroll-oct", obligationRevision: 1, wallet: context.wallet, amount: usdc("4000000000"), feeReserve: usdc("1000"), gasBudgetWei: "1000000000000000", expiresAt: new Date(Date.now()+300000).toISOString(), executionEnabled: true, executionReason: "Verified", startBlock: "10" } } as PaymentRecord);
  return id;
}
async function pending(id: string) { await vi.waitFor(async () => expect((await inspectPayment(context, id)).pending).not.toBeNull()); return (await inspectPayment(context, id)).pending!; }
beforeEach(() => { fake.records.clear(); fake.leases.clear(); fake.claimed = false; fake.current = context; fake.policy.mockReturnValue({ status: "PASS" }); fake.proof.mockReturnValue({}); fake.receipt.mockResolvedValue({}); fake.transaction.mockResolvedValue({ from: context.wallet.address, to: "0x3600000000000000000000000000000000000000", input: "0x1234", value: 0n }); });
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
});
