import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createViemAdapter, externalSigning, type EvmCallsPayload } from "@circle-fin/adapter-viem-v2/next";
import { ArcTestnet } from "@circle-fin/app-kit/chains";
import { formatUnits, getAddress } from "viem";
import { earnServerContext } from "@/lib/earn/server-context";
import { arcClient, earnKit } from "@/lib/earn/gateway";
import { digest } from "@/lib/earn/durable-quotes";
import { EarnAccessError } from "@/lib/earn/security";
import { paymentAdmin } from "./admin";
import { freshPaymentWorkspace, readPayment, transferCall, type PaymentContext } from "./server";
import { assessPayment } from "./policy";
import { verifyPaymentReceipt } from "./receipts";
import type { PaymentProposal } from "./models";

type Pending = { id: string; calls: { to: `0x${string}`; data: `0x${string}`; value: string }[]; gasBudgetWei: string };
type Job = { binding: string; lease: string; proposal: PaymentProposal; pending?: Pending; resolve?: (hash: `0x${string}`) => void; reject?: (error: Error) => void; exposed: boolean };
const globalJobs = globalThis as typeof globalThis & { hoddPaymentJobs?: Map<string, Job> };
const jobs = globalJobs.hoddPaymentJobs ??= new Map<string, Job>();

async function validateClaimedPolicy(context: PaymentContext, proposal: PaymentProposal) {
  const live = await freshPaymentWorkspace(context);
  const own = live.paymentReservations?.find((item) => item.proposalId === proposal.id);
  if (!own) throw new Error("PAYMENT_RESERVATION_MISSING");
  const pending = BigInt(live.pendingTransactions.minorUnits) - BigInt(own.amount.minorUnits) - BigInt(own.feeReserve.minorUnits);
  if (pending < 0n) throw new Error("PAYMENT_RESERVATION_INVALID");
  const available = { ...live, pendingTransactions: { ...live.pendingTransactions, minorUnits: pending.toString() }, paymentReservations: live.paymentReservations?.filter((item) => item.proposalId !== proposal.id) };
  const obligation = available.obligations.find((item) => item.id === proposal.obligationId);
  if (!obligation || obligation.revision !== proposal.obligationRevision || assessPayment(available, obligation, proposal.feeReserve).status !== "PASS") throw new Error("FRESH_PAYMENT_POLICY_BLOCKED");
}

async function signingRequest(job: Job, context: PaymentContext, payload: EvmCallsPayload) {
  await validateClaimedPolicy(context, job.proposal);
  if (Date.parse(job.proposal.expiresAt) <= Date.now()) throw new Error("PAYMENT_EXPIRED");
  const expected = transferCall(job.proposal);
  if (payload.chain.chainId !== 5_042_002 || payload.fromAddress.toLowerCase() !== context.wallet.address.toLowerCase() || payload.calls.length !== 1 || payload.calls[0].to.toLowerCase() !== expected.to.toLowerCase() || payload.calls[0].data?.toLowerCase() !== expected.data.toLowerCase() || (payload.calls[0].value ?? 0n) !== 0n) throw new Error("PAYMENT_PAYLOAD_MISMATCH");
  return new Promise<`0x${string}`>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("SIGNATURE_OUTCOME_UNKNOWN")), Math.max(1, Date.parse(job.proposal.expiresAt) - Date.now()));
    job.resolve = (hash) => { clearTimeout(timer); resolve(hash); };
    job.reject = (error) => { clearTimeout(timer); reject(error); };
    // Once exposed, lack of a reported hash cannot prove that nothing was sent.
    job.exposed = true;
    job.pending = { id: randomUUID(), calls: [expected], gasBudgetWei: job.proposal.gasBudgetWei };
  });
}

async function settlePayment(context: PaymentContext, proposal: PaymentProposal, hash: `0x${string}`) {
  if (await arcClient.getChainId() !== 5_042_002) throw new Error("WRONG_RECEIPT_CHAIN");
  const receipt = await arcClient.waitForTransactionReceipt({ hash, timeout: 120_000 });
  const proof = verifyPaymentReceipt(receipt, proposal);
  if (context.wallet.accountType === "EOA") {
    const transaction = await arcClient.getTransaction({ hash }); const call = transferCall(proposal);
    if (transaction.from.toLowerCase() !== proposal.wallet.address.toLowerCase() || transaction.to?.toLowerCase() !== call.to.toLowerCase() || transaction.input.toLowerCase() !== call.data.toLowerCase() || transaction.value !== 0n) throw new Error("PAYMENT_TRANSACTION_MISMATCH");
  }
  const { error } = await paymentAdmin().rpc("hodd_finish_payment", { p_user: context.userId, p_scope: context.scope, p_id: proposal.id, p_hash: hash, p_receipt: proof });
  if (error) throw new Error("PAYMENT_LEDGER_CONFIRMATION_UNAVAILABLE");
}

async function runPayment(job: Job, context: PaymentContext) {
  let finished = false;
  try {
    const adapter = createViemAdapter({ capabilities: { addressContext: "user-controlled", supportedChains: [ArcTestnet] }, address: getAddress(context.wallet.address), getPublicClient: () => arcClient, signing: externalSigning({ sign: async (payload) => ({ txHash: await signingRequest(job, context, payload) }) }) });
    const result = await earnKit.send({ from: { adapter, chain: "Arc_Testnet" }, to: job.proposal.recipientAddress, amount: formatUnits(BigInt(job.proposal.amount.minorUnits), 6), token: "USDC" });
    if (!result.txHash || result.state !== "success") throw new Error("PAYMENT_RESULT_UNKNOWN");
    await settlePayment(context, job.proposal, result.txHash as `0x${string}`); finished = true;
  } catch {
    const admin = paymentAdmin();
    if (job.exposed) {
      await admin.from("payment_proposals").update({ state: "UNKNOWN", updated_at: new Date().toISOString() }).eq("id", job.proposal.id).eq("user_id", context.userId).in("state", ["AWAITING_SIGNATURE", "SUBMITTED"]);
    } else {
      const { error } = await admin.rpc("hodd_cancel_payment", { p_user: context.userId, p_scope: context.scope, p_id: job.proposal.id, p_binding: job.binding, p_state: "FAILED" }); finished = !error;
    }
  } finally {
    delete job.pending; delete job.resolve; delete job.reject;
    if (finished) await unlink(job.lease).catch(() => undefined);
  }
}

export async function startPayment(context: PaymentContext, id: string) {
  const { row, record } = await readPayment(context, id);
  if (!record.proposal.executionEnabled || context.wallet.accountType !== "EOA") throw new EarnAccessError("PROVIDER_NOT_VERIFIED", record.proposal.executionReason, 409);
  if (row.policy_digest !== context.policyDigest || record.state !== "REVIEW_REQUIRED" || Date.parse(record.proposal.expiresAt) <= Date.now()) throw new EarnAccessError("PROPOSAL_NOT_AVAILABLE", "Request a fresh payment proposal.", 409);
  const live = await freshPaymentWorkspace(context); const obligation = live.obligations.find((item) => item.id === record.proposal.obligationId);
  if (!obligation || assessPayment(live, obligation, record.proposal.feeReserve).status !== "PASS") throw new EarnAccessError("POLICY_BLOCKED", "Fresh policy does not permit this payment.", 409);
  // Same directory and address digest as Earn: mutual exclusion across products,
  // users, quotes and local server processes. UNKNOWN keeps the durable lease.
  const directory = join(process.cwd(), ".hodd-local", "leases"); await mkdir(directory, { recursive: true });
  const lease = join(directory, digest(context.wallet.address.toLowerCase()));
  try { await writeFile(lease, id, { flag: "wx", mode: 0o600 }); }
  catch { throw new EarnAccessError("WALLET_BUSY", "Another Earn or payment execution needs completion or review.", 409); }
  const { error } = await paymentAdmin().rpc("hodd_claim_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding });
  if (error) { await unlink(lease).catch(() => undefined); throw new EarnAccessError("PROPOSAL_NOT_AVAILABLE", "The proposal expired, was consumed or its workspace changed.", 409); }
  const job: Job = { binding: context.binding, proposal: record.proposal, lease, exposed: false }; jobs.set(id, job);
  try { const claimed = await earnServerContext(context.scope); void runPayment(job, claimed); }
  catch { await paymentAdmin().rpc("hodd_cancel_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding, p_state: "FAILED" }); await unlink(lease).catch(() => undefined); throw new Error("CLAIMED_SESSION_UNAVAILABLE"); }
  return inspectPayment(context, id);
}

export async function inspectPayment(context: PaymentContext, id: string) {
  const { record } = await readPayment(context, id, true); const job = jobs.get(id);
  return { status: "READY" as const, record, pending: job?.binding === context.binding ? job.pending ?? null : null };
}

export async function replyPayment(context: PaymentContext, id: string, input: { requestId: string; txHash?: string; userOperationHash?: string; cancelled?: boolean }) {
  await readPayment(context, id); const job = jobs.get(id);
  if (!job || job.binding !== context.binding || job.pending?.id !== input.requestId) throw new EarnAccessError("REQUEST_ALREADY_ANSWERED", "The signature request is unavailable or already answered.", 409);
  if (input.userOperationHash) throw new EarnAccessError("PROVIDER_NOT_VERIFIED", "Smart-account execution is not yet verified.", 409);
  if (input.cancelled) { delete job.pending; job.reject?.(new Error("SIGNATURE_REQUIRES_REVIEW")); }
  else if (input.txHash) {
    delete job.pending;
    const { error } = await paymentAdmin().from("payment_proposals").update({ state: "SUBMITTED", tx_hash: input.txHash, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).eq("state", "AWAITING_SIGNATURE");
    if (error) { job.reject?.(new Error("SUBMISSION_RECORD_UNAVAILABLE")); throw new Error("SUBMISSION_RECORD_UNAVAILABLE"); }
    job.resolve?.(input.txHash as `0x${string}`);
  }
  return inspectPayment(context, id);
}

export async function recheckPayment(context: PaymentContext, id: string, candidateHash?: string) {
  const { record } = await readPayment(context, id, true);
  const hash = record.txHash ?? candidateHash;
  if (record.txHash && candidateHash && record.txHash.toLowerCase() !== candidateHash.toLowerCase()) throw new EarnAccessError("RECEIPT_HASH_MISMATCH", "This payment is already bound to a different submitted hash.", 409);
  if (["SUBMITTED", "UNKNOWN"].includes(record.state) && hash) {
    await settlePayment(context, record.proposal, hash as `0x${string}`);
    const lease = join(process.cwd(), ".hodd-local", "leases", digest(record.proposal.wallet.address.toLowerCase()));
    if (await readFile(lease, "utf8").catch(() => null) === id) await unlink(lease).catch(() => undefined);
  }
  return inspectPayment(context, id);
}
