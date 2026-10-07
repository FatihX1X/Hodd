import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createViemAdapter, externalSigning, type EvmCallsPayload } from "@circle-fin/adapter-viem-v2/next";
import { ArcTestnet } from "@circle-fin/app-kit/chains";
import { formatUnits, getAddress } from "viem";
import { createCircleUserWalletAdapter } from "@circle-fin/adapter-circle-wallets/ucw/server";
import { circleUserWalletClient } from "@/lib/circle/user-wallet-server";
import { assertFeeBinding } from "@/lib/wallet/fee-quote";
import { quotePaymentFees } from "./fees";
import { hasVerifiedEarnProvider } from "@/lib/earn/provider-evidence";
import { earnServerContext } from "@/lib/earn/server-context";
import { arcClient, earnKit } from "@/lib/earn/gateway";
import { digest } from "@/lib/earn/durable-quotes";
import { EarnAccessError } from "@/lib/earn/security";
import { paymentAdmin } from "./admin";
import { freshPaymentWorkspace, readPayment, transferCall, type PaymentContext } from "./server";
import { assessPayment } from "./policy";
import { verifyPaymentReceipt, verifyPaymentRevert } from "./receipts";
import type { PaymentProposal } from "./models";
import { verifyPaymentUserOperation, resolvePaymentUserOperation } from "./user-operation";

type Pending = { id: string; calls: { to: `0x${string}`; data: `0x${string}`; value: string }[]; gasBudgetWei: string; challengeId?: string };
type Job = { binding: string; lease: string; proposal: PaymentProposal; pending?: Pending; resolve?: (hash: `0x${string}`) => void; reject?: (error: Error) => void; exposed: boolean; cancelled: boolean; writes: Promise<void>; userOperationReported?: boolean; testSignerClaimed?: boolean };
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
  await validateFreshFees(context, proposal);
}

async function validateFreshFees(context: PaymentContext, proposal: PaymentProposal) {
  const call = transferCall(proposal);
  const approved = assertFeeBinding(proposal.feeQuote ?? undefined, { provider: context.wallet.provider, address: context.wallet.address, digest: digest(call) });
  if (approved.maxNativeFeeWei !== proposal.gasBudgetWei || approved.maxWalletDebit.minorUnits !== proposal.feeReserve.minorUnits) throw new Error("FEE_RESERVE_MISMATCH");
  const fresh = await quotePaymentFees(context, call);
  if (!fresh || BigInt(fresh.gasLimit) > BigInt(approved.gasLimit) || BigInt(fresh.maxFeePerGasWei) > BigInt(approved.maxFeePerGasWei) || BigInt(fresh.priorityFeePerGasWei) > BigInt(approved.priorityFeePerGasWei)) throw new Error("FRESH_FEE_EXCEEDS_QUOTE");
  if (approved.userOperation) {
    const expected = approved.userOperation; const current = fresh.userOperation;
    if (!current || current.nonce !== expected.nonce || current.callData.toLowerCase() !== expected.callData.toLowerCase() || current.factory?.toLowerCase() !== expected.factory?.toLowerCase() || current.factoryData?.toLowerCase() !== expected.factoryData?.toLowerCase() || current.paymaster.toLowerCase() !== expected.paymaster.toLowerCase()) throw new Error("USER_OPERATION_CHANGED");
    for (const field of ["callGasLimit", "verificationGasLimit", "preVerificationGas", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"] as const) if (BigInt(current[field]) > BigInt(expected[field])) throw new Error("FRESH_FEE_EXCEEDS_QUOTE");
  }
  return approved;
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
  if (proposal.wallet.provider === "CIRCLE_MODULAR") {
    const { record } = await readPayment(context, proposal.id, true);
    const verified = await verifyPaymentUserOperation(receipt, proposal, record.userOperationHash);
    if (!verified.success) {
      const { error } = await paymentAdmin().rpc("hodd_fail_payment_user_operation", { p_user: context.userId, p_scope: context.scope, p_id: proposal.id, p_hash: hash, p_receipt: { status: "USER_OPERATION_REVERTED", blockNumber: receipt.blockNumber.toString(), ...verified } });
      if (error) throw new Error("USER_OPERATION_FAILURE_LEDGER_UNAVAILABLE");
      return;
    }
    if (!record.userOperationHash) {
      const { error } = await paymentAdmin().from("payment_proposals").update({ user_operation_hash: verified.userOperationHash }).eq("id", proposal.id).eq("user_id", context.userId).is("user_operation_hash", null);
      if (error) throw new Error("USER_OPERATION_RECORD_UNAVAILABLE");
    }
  }
  if (context.wallet.accountType === "EOA") {
    const transaction = await arcClient.getTransaction({ hash }); const call = transferCall(proposal);
    if (transaction.from.toLowerCase() !== proposal.wallet.address.toLowerCase() || transaction.to?.toLowerCase() !== call.to.toLowerCase() || transaction.input.toLowerCase() !== call.data.toLowerCase() || transaction.value !== 0n) throw new Error("PAYMENT_TRANSACTION_MISMATCH");
  }
  if (receipt.status === "reverted" && context.wallet.accountType === "EOA") {
    const proof = verifyPaymentRevert(receipt, proposal);
    const { error } = await paymentAdmin().rpc("hodd_fail_payment_receipt", { p_user: context.userId, p_scope: context.scope, p_id: proposal.id, p_hash: hash, p_receipt: proof });
    if (error) throw new Error("PAYMENT_LEDGER_FAILURE_UNAVAILABLE");
    return;
  }
  const proof = verifyPaymentReceipt(receipt, proposal);
  const { error } = await paymentAdmin().rpc("hodd_finish_payment", { p_user: context.userId, p_scope: context.scope, p_id: proposal.id, p_hash: hash, p_receipt: proof });
  if (error) throw new Error("PAYMENT_LEDGER_CONFIRMATION_UNAVAILABLE");
}

async function embeddedPaymentAdapter(job: Job, context: PaymentContext) {
  const client = circleUserWalletClient();
  if (!client || !context.userToken || !context.wallet.walletId) throw new Error("EMBEDDED_SESSION_REQUIRED");
  const cappedClient = new Proxy(client, { get(target, key) {
    if (key === "createUserTransactionTransferChallenge") return () => { throw new Error("UNBOUNDED_TRANSFER_NOT_ALLOWED"); };
    if (key === "createUserTransactionContractExecutionChallenge") return async (input: Parameters<typeof client.createUserTransactionContractExecutionChallenge>[0]) => {
      await validateClaimedPolicy(context, job.proposal);
      const expected = transferCall(job.proposal);
      if (job.cancelled || input.walletId !== context.wallet.walletId || input.contractAddress.toLowerCase() !== expected.to.toLowerCase() || input.callData?.toLowerCase() !== expected.data.toLowerCase() || (input.amount !== undefined && input.amount !== "0")) throw new Error("PAYMENT_PAYLOAD_MISMATCH");
      const fee = job.proposal.feeQuote!;
      // A timed-out API request may already have created the challenge. Hold it.
      job.exposed = true;
      return target.createUserTransactionContractExecutionChallenge({ ...input, fee: { type: "absolute", config: { gasLimit: fee.gasLimit, maxFee: formatUnits(BigInt(fee.maxFeePerGasWei), 9), priorityFee: formatUnits(BigInt(fee.priorityFeePerGasWei), 9) } } });
    };
    const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
  } });
  return createCircleUserWalletAdapter({ client: cappedClient, userToken: context.userToken, walletId: context.wallet.walletId, walletAddress: getAddress(context.wallet.address), chain: "Arc_Testnet", accountType: "SCA", timeoutMs: Math.max(1, Date.parse(job.proposal.expiresAt) - Date.now()),
    onChallenge: ({ challengeId }) => { if (!job.cancelled) job.pending = { id: randomUUID(), calls: [], gasBudgetWei: job.proposal.gasBudgetWei, challengeId }; },
    onProgress: (progress) => {
      job.writes = job.writes.then(async () => {
        if (progress.stage === "challenge") {
          const stage = ["COMPLETE", "COMPLETED"].includes(progress.status) ? "PIN_APPROVED" : ["DENIED", "FAILED"].includes(progress.status) ? "PIN_REJECTED" : progress.status === "PENDING" ? "PIN_APPROVAL_REQUESTED" : null;
          if (stage) {
            const { error } = await paymentAdmin().from("payment_events").insert({ user_id: context.userId, scope: context.scope, proposal_id: job.proposal.id, stage, kind: "LOCAL_AUDIT" });
            if (error) throw new Error("PAYMENT_AUDIT_UNAVAILABLE");
          }
          return;
        }
        if (progress.stage !== "transaction") return;
        delete job.pending;
        const { error } = await paymentAdmin().from("payment_proposals").update({ state: "SUBMITTED", ...(progress.txHash ? { tx_hash: progress.txHash } : {}), ...(progress.transactionId ? { provider_transaction_id: progress.transactionId } : {}), updated_at: new Date().toISOString() }).eq("id", job.proposal.id).eq("user_id", context.userId).in("state", ["AWAITING_SIGNATURE", "SUBMITTED"]);
        if (error) throw new Error("SUBMISSION_RECORD_UNAVAILABLE");
      });
      // The SDK progress callback is observational. Settlement awaits the chain.
      void job.writes.catch(() => undefined);
    },
  });
}

async function runPayment(job: Job, context: PaymentContext) {
  let finished = false;
  try {
    const adapter = context.wallet.provider === "CIRCLE_USER_CONTROLLED" ? await embeddedPaymentAdapter(job, context) : createViemAdapter({ capabilities: { addressContext: "user-controlled", supportedChains: [ArcTestnet] }, address: getAddress(context.wallet.address), getPublicClient: () => arcClient, signing: externalSigning({ sign: async (payload) => ({ txHash: await signingRequest(job, context, payload) }) }) });
    const result = await earnKit.send({ from: { adapter, chain: "Arc_Testnet" }, to: job.proposal.recipientAddress, amount: formatUnits(BigInt(job.proposal.amount.minorUnits), 6), token: "USDC" });
    await job.writes;
    if (!result.txHash || result.state !== "success") throw new Error("PAYMENT_RESULT_UNKNOWN");
    await settlePayment(context, job.proposal, result.txHash as `0x${string}`); finished = true;
  } catch {
    await job.writes.catch(() => undefined);
    const admin = paymentAdmin();
    // The dev test signer is the server itself: an unclaimed request was provably never signed.
    const neverSigned = context.wallet.provider === "TEST_SIGNER" && !job.testSignerClaimed;
    if (job.exposed && !neverSigned) {
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
  if (!record.proposal.executionEnabled || !await hasVerifiedEarnProvider(context)) throw new EarnAccessError("PROVIDER_NOT_VERIFIED", record.proposal.executionReason, 409);
  if (row.policy_digest !== context.policyDigest || record.state !== "REVIEW_REQUIRED" || Date.parse(record.proposal.expiresAt) <= Date.now()) throw new EarnAccessError("PROPOSAL_NOT_AVAILABLE", "Request a fresh payment proposal.", 409);
  const live = await freshPaymentWorkspace(context); const obligation = live.obligations.find((item) => item.id === record.proposal.obligationId);
  if (!obligation || assessPayment(live, obligation, record.proposal.feeReserve).status !== "PASS") throw new EarnAccessError("POLICY_BLOCKED", "Fresh policy does not permit this payment.", 409);
  await validateFreshFees(context, record.proposal);
  // Same directory and address digest as Earn: mutual exclusion across products,
  // users, quotes and local server processes. UNKNOWN keeps the durable lease.
  const directory = join(process.cwd(), ".hodd-local", "leases"); await mkdir(directory, { recursive: true });
  const lease = join(directory, digest(context.wallet.address.toLowerCase()));
  try { await writeFile(lease, id, { flag: "wx", mode: 0o600 }); }
  catch { throw new EarnAccessError("WALLET_BUSY", "Another Earn or payment execution needs completion or review.", 409); }
  const { error } = await paymentAdmin().rpc("hodd_claim_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding });
  if (error) {
    // A lost HTTP response is not proof that the atomic claim did not commit.
    const cancelled = await paymentAdmin().rpc("hodd_cancel_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding, p_state: "FAILED" });
    if (!cancelled.error) await unlink(lease).catch(() => undefined);
    throw new EarnAccessError("PROPOSAL_NOT_AVAILABLE", "The claim could not be verified. Recheck its existing state before requesting another proposal.", 409);
  }
  const job: Job = { binding: context.binding, proposal: record.proposal, lease, exposed: false, cancelled: false, writes: Promise.resolve() }; jobs.set(id, job);
  try { const claimed = await earnServerContext(context.scope); void runPayment(job, claimed); }
  catch { const { error } = await paymentAdmin().rpc("hodd_cancel_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding, p_state: "FAILED" }); if (!error) await unlink(lease).catch(() => undefined); throw new Error("CLAIMED_SESSION_UNAVAILABLE"); }
  return inspectPayment(context, id);
}

const testSignerAnswered = new Set<string>();
/**
 * Dev-only test signer: returns this session's exact pending USDC transfer and
 * its approved fee quote, once. Smart-account and PIN requests are never claimed.
 */
export function claimTestSignerPayment(binding: string, calls: readonly { to: string; data?: string; value?: string }[]) {
  for (const job of jobs.values()) {
    const pending = job.pending; const fee = job.proposal.feeQuote;
    if (job.binding !== binding || !pending || pending.challengeId || testSignerAnswered.has(pending.id) || !fee || fee.source !== "ARC_EOA" || Date.parse(fee.expiresAt) <= Date.now()) continue;
    const expected = pending.calls[0];
    if (pending.calls.length !== 1 || calls.length !== 1 || calls[0].to.toLowerCase() !== expected.to.toLowerCase() || (calls[0].data ?? "0x").toLowerCase() !== expected.data.toLowerCase() || (calls[0].value ?? "0") !== "0") continue;
    testSignerAnswered.add(pending.id); job.testSignerClaimed = true;
    return { call: expected, feeQuote: fee };
  }
  throw new EarnAccessError("TEST_SIGNER_REQUEST_NOT_FOUND", "No matching pending payment signature request for this session.", 409);
}

export async function inspectPayment(context: PaymentContext, id: string) {
  const { record } = await readPayment(context, id, true); const job = jobs.get(id);
  return { status: "READY" as const, record, pending: job?.binding === context.binding ? job.pending ?? null : null };
}

export async function replyPayment(context: PaymentContext, id: string, input: { requestId: string; txHash?: string; userOperationHash?: string; cancelled?: boolean; challengeApproved?: boolean }) {
  await readPayment(context, id); const job = jobs.get(id);
  if (!job || job.binding !== context.binding || job.pending?.id !== input.requestId) throw new EarnAccessError("REQUEST_ALREADY_ANSWERED", "The signature request is unavailable or already answered.", 409);
  if (job.pending.challengeId) {
    if (input.txHash || input.userOperationHash || (!input.cancelled && !input.challengeApproved)) throw new EarnAccessError("INVALID_PIN_REPLY", "PIN replies cannot supply a transaction hash.", 400);
    delete job.pending;
    if (input.cancelled) {
      job.cancelled = true;
      await paymentAdmin().from("payment_proposals").update({ state: "UNKNOWN", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).in("state", ["AWAITING_SIGNATURE", "SUBMITTED"]);
    }
    // Approval acknowledgment is not execution proof; the SDK polls Circle.
    return inspectPayment(context, id);
  }
  if (input.challengeApproved) throw new EarnAccessError("INVALID_PIN_REPLY", "This request requires browser-wallet signing.", 400);
  if (input.userOperationHash) {
    if (context.wallet.provider !== "CIRCLE_MODULAR" || !job.proposal.feeQuote?.userOperation || input.txHash || input.cancelled) throw new EarnAccessError("INVALID_USER_OPERATION", "Only the selected passkey operation can report a UserOperation hash.", 400);
    const { record } = await readPayment(context, id);
    if (record.userOperationHash || job.userOperationReported) throw new EarnAccessError("REQUEST_ALREADY_ANSWERED", "The UserOperation is already recorded.", 409);
    job.userOperationReported = true;
    const { error } = await paymentAdmin().from("payment_proposals").update({ user_operation_hash: input.userOperationHash, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).eq("state", "AWAITING_SIGNATURE").is("user_operation_hash", null);
    if (error) throw new Error("USER_OPERATION_RECORD_UNAVAILABLE");
    return inspectPayment(context, id);
  }
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
  const hash = record.txHash ?? candidateHash ?? (record.userOperationHash && context.wallet.provider === "CIRCLE_MODULAR" ? await resolvePaymentUserOperation(record.proposal, record.userOperationHash) : undefined);
  if (record.txHash && candidateHash && record.txHash.toLowerCase() !== candidateHash.toLowerCase()) throw new EarnAccessError("RECEIPT_HASH_MISMATCH", "This payment is already bound to a different submitted hash.", 409);
  if (["SUBMITTED", "UNKNOWN"].includes(record.state) && hash) {
    await settlePayment(context, record.proposal, hash as `0x${string}`);
    const lease = join(process.cwd(), ".hodd-local", "leases", digest(record.proposal.wallet.address.toLowerCase()));
    if (await readFile(lease, "utf8").catch(() => null) === id) await unlink(lease).catch(() => undefined);
  }
  return inspectPayment(context, id);
}
