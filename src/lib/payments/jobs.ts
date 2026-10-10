import "server-only";
import { randomUUID } from "node:crypto";
import { getAddress } from "viem";
import { z } from "zod";
import { circleUserWalletClient } from "@/lib/circle/user-wallet-server";
import { assertFeeBinding } from "@/lib/wallet/fee-quote";
import { modularReadClient } from "@/lib/wallet/modular-server";
import { arcClient } from "@/lib/earn/gateway";
import { digest } from "@/lib/earn/digest";
import { quotedSigningGasPrice } from "@/lib/earn/gas";
import { EarnAccessError } from "@/lib/earn/security";
import { earnServerContext } from "@/lib/earn/server-context";
import type { ExecutionMode } from "@/lib/earn/access-policy";
import { assertLiveReady } from "@/lib/execution/live-readiness";
import { quotePaymentFees } from "./fees";
import { paymentAdmin } from "./admin";
import { freshPaymentWorkspace, readPayment, transferCall, type PaymentContext } from "./server";
import { assessPayment } from "./policy";
import { verifyPaymentReceipt, verifyPaymentRevert } from "./receipts";
import type { PaymentProposal } from "./models";
import { verifyPaymentUserOperation, resolvePaymentUserOperation } from "./user-operation";

const integer = z.string().regex(/^\d+$/);
export const paymentPendingSchema = z.object({
  id: z.string().uuid(), calls: z.array(z.object({ to: z.string(), data: z.string(), value: integer })).length(1), gasBudgetWei: integer,
  expiresAt: z.string().datetime(), nonce: integer.optional(), gasCeiling: z.object({ gasLimit: integer, gasPriceWei: integer }).optional(), challengeId: z.string().optional(), challengeApproved: z.boolean().optional(), testSignerClaimed: z.boolean().optional(),
});
type Pending = z.infer<typeof paymentPendingSchema>;
type Row = Awaited<ReturnType<typeof readPayment>>["row"];
const SIGNATURE_GRACE_MS = 60_000;
const admin = () => paymentAdmin();
const pendingOf = (row: Row) => { const parsed = paymentPendingSchema.safeParse(row.pending); return parsed.success ? parsed.data : null; };
// Gateway-rail payments have their own state machine (src/lib/gateway/payments.ts).
const arcOnly = (proposal: PaymentProposal) => { if (proposal.rail === "GATEWAY") throw new EarnAccessError("GATEWAY_PAYMENT", "This payment is paid from your Gateway balance. Use the cross-chain payment controls.", 409); };
const answered = (row: Row, pending: Pending) => Boolean(row.tx_hash || row.user_operation_hash || pending.challengeApproved);

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
  if (!fresh || BigInt(fresh.gasLimit) > BigInt(approved.gasLimit)) throw new Error("FRESH_FEE_EXCEEDS_QUOTE");
  // An EOA quote already carries the 2x price buffer: compare the raw network price
  // with it, never a second buffered price (a small price move would fail spuriously).
  if (approved.source === "ARC_EOA") quotedSigningGasPrice(await arcClient.getGasPrice(), BigInt(approved.maxFeePerGasWei));
  else if (BigInt(fresh.maxFeePerGasWei) > BigInt(approved.maxFeePerGasWei) || BigInt(fresh.priorityFeePerGasWei) > BigInt(approved.priorityFeePerGasWei)) throw new Error("FRESH_FEE_EXCEEDS_QUOTE");
  if (approved.userOperation) {
    const expected = approved.userOperation; const current = fresh.userOperation;
    if (!current || current.nonce !== expected.nonce || current.callData.toLowerCase() !== expected.callData.toLowerCase() || current.factory?.toLowerCase() !== expected.factory?.toLowerCase() || current.factoryData?.toLowerCase() !== expected.factoryData?.toLowerCase() || current.paymaster.toLowerCase() !== expected.paymaster.toLowerCase()) throw new Error("USER_OPERATION_CHANGED");
    for (const field of ["callGasLimit", "verificationGasLimit", "preVerificationGas", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit"] as const) if (BigInt(current[field]) > BigInt(expected[field])) throw new Error("FRESH_FEE_EXCEEDS_QUOTE");
  }
  return approved;
}

/** Verifies a mined hash and finalizes the ledger. False while not yet mined. */
async function settlePayment(context: PaymentContext, proposal: PaymentProposal, hash: `0x${string}`) {
  if (await arcClient.getChainId() !== 5_042_002) throw new Error("WRONG_RECEIPT_CHAIN");
  let receipt;
  try { receipt = await arcClient.getTransactionReceipt({ hash }); } catch { return false; }
  if (proposal.wallet.provider === "CIRCLE_MODULAR") {
    const { record } = await readPayment(context, proposal.id, true);
    const verified = await verifyPaymentUserOperation(receipt, proposal, record.userOperationHash);
    if (!verified.success) {
      const { error } = await admin().rpc("hodd_fail_payment_user_operation", { p_user: context.userId, p_scope: context.scope, p_id: proposal.id, p_hash: hash, p_receipt: { status: "USER_OPERATION_REVERTED", blockNumber: receipt.blockNumber.toString(), ...verified } });
      if (error) throw new Error("USER_OPERATION_FAILURE_LEDGER_UNAVAILABLE");
      return true;
    }
    if (!record.userOperationHash) {
      const { error } = await admin().from("payment_proposals").update({ user_operation_hash: verified.userOperationHash }).eq("id", proposal.id).eq("user_id", context.userId).is("user_operation_hash", null);
      if (error) throw new Error("USER_OPERATION_RECORD_UNAVAILABLE");
    }
  }
  if (context.wallet.accountType === "EOA") {
    const transaction = await arcClient.getTransaction({ hash }); const call = transferCall(proposal);
    if (transaction.from.toLowerCase() !== proposal.wallet.address.toLowerCase() || transaction.to?.toLowerCase() !== call.to.toLowerCase() || transaction.input.toLowerCase() !== call.data.toLowerCase() || transaction.value !== 0n) throw new Error("PAYMENT_TRANSACTION_MISMATCH");
  }
  if (receipt.status === "reverted" && context.wallet.accountType === "EOA") {
    const { error } = await admin().rpc("hodd_fail_payment_receipt", { p_user: context.userId, p_scope: context.scope, p_id: proposal.id, p_hash: hash, p_receipt: verifyPaymentRevert(receipt, proposal) });
    if (error) throw new Error("PAYMENT_LEDGER_FAILURE_UNAVAILABLE");
    return true;
  }
  const { error } = await admin().rpc("hodd_finish_payment", { p_user: context.userId, p_scope: context.scope, p_id: proposal.id, p_hash: hash, p_receipt: verifyPaymentReceipt(receipt, proposal) });
  if (error) throw new Error("PAYMENT_LEDGER_CONFIRMATION_UNAVAILABLE");
  return true;
}

/** Claims the proposal (and, through the database trigger, the wallet lease), then records the exact call to sign. */
export async function startPayment(context: PaymentContext, mode: ExecutionMode, id: string) {
  await assertLiveReady(context, mode, "START");
  const { row, record } = await readPayment(context, id); arcOnly(record.proposal);
  if (!record.proposal.executionEnabled) throw new EarnAccessError("EXECUTION_NOT_ENABLED", record.proposal.executionReason, 409);
  if (row.policy_digest !== context.policyDigest || record.state !== "REVIEW_REQUIRED" || Date.parse(record.proposal.expiresAt) <= Date.now()) throw new EarnAccessError("PROPOSAL_NOT_AVAILABLE", "Request a fresh payment proposal.", 409);
  const live = await freshPaymentWorkspace(context); const obligation = live.obligations.find((item) => item.id === record.proposal.obligationId);
  if (!obligation || assessPayment(live, obligation, record.proposal.feeReserve).status !== "PASS") throw new EarnAccessError("POLICY_BLOCKED", "Fresh policy does not permit this payment.", 409);
  try { await validateFreshFees(context, record.proposal); }
  catch { throw new EarnAccessError("FEE_QUOTE_EXCEEDED", "Network fees changed beyond the approved quote. Review a fresh payment proposal; nothing was sent.", 409); }
  const { error } = await admin().rpc("hodd_claim_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding });
  if (error) {
    if (/wallet busy/i.test(error.message)) throw new EarnAccessError("WALLET_BUSY", "Another Earn or payment execution on this wallet needs completion or review. Resolve open Earn executions on the Strategies page, or open payments in the payment ledger.", 409);
    // A lost response is not proof that the atomic claim did not commit; release it if it did.
    await admin().rpc("hodd_cancel_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding, p_state: "FAILED" });
    throw new EarnAccessError("PROPOSAL_NOT_AVAILABLE", "The claim could not be verified. Recheck its existing state before requesting another proposal.", 409);
  }
  try {
    // The claim reserved funds in the workspace; re-read it before the final policy check.
    await validateClaimedPolicy(await earnServerContext(context.scope), record.proposal);
    const call = transferCall(record.proposal);
    const pending: Pending = { id: randomUUID(), calls: [call], gasBudgetWei: record.proposal.gasBudgetWei, expiresAt: record.proposal.expiresAt };
    if (context.wallet.accountType === "EOA") {
      pending.nonce = BigInt(await arcClient.getTransactionCount({ address: getAddress(context.wallet.address), blockTag: "pending" })).toString();
      // A server-bound ceiling, like Earn: the browser signs at this price without its own RPC reads.
      const fee = record.proposal.feeQuote!; const gasPriceWei = quotedSigningGasPrice(await arcClient.getGasPrice(), BigInt(fee.maxFeePerGasWei));
      if (BigInt(fee.gasLimit) * gasPriceWei > BigInt(record.proposal.gasBudgetWei)) throw new Error("FEE_RESERVE_EXCEEDED");
      pending.gasCeiling = { gasLimit: fee.gasLimit, gasPriceWei: gasPriceWei.toString() };
    }
    else if (context.wallet.provider === "CIRCLE_MODULAR") pending.nonce = (await (await modularReadClient(context.wallet)).account.getNonce()).toString();
    else if (context.wallet.provider === "CIRCLE_USER_CONTROLLED") {
      const circle = circleUserWalletClient();
      if (!circle || !context.userToken || !context.wallet.walletId) throw new Error("EMBEDDED_SESSION_REQUIRED");
      // Circle requires a fee level for SCA wallets (155232); the reserve is enforced by policy.
      const { data } = await circle.createUserTransactionContractExecutionChallenge({ userToken: context.userToken, walletId: context.wallet.walletId, contractAddress: call.to, callData: call.data, fee: { type: "level", config: { feeLevel: "MEDIUM" } }, idempotencyKey: pending.id });
      if (!data?.challengeId) throw new Error("CHALLENGE_UNAVAILABLE");
      pending.challengeId = data.challengeId;
    }
    const { data, error: pendingError } = await admin().from("payment_proposals").update({ pending, provider_challenge_id: pending.challengeId ?? null, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).eq("state", "AWAITING_SIGNATURE").is("pending", null).select("id");
    if (pendingError || !data?.length) throw new Error("PENDING_RECORD_UNAVAILABLE");
  } catch {
    // Nothing was shown to a signer yet: release the claim and the lease.
    await admin().rpc("hodd_cancel_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding, p_state: "FAILED" });
    throw new EarnAccessError("PAYMENT_PREPARATION_FAILED", "The payment could not be prepared for signing. Nothing was submitted; request a fresh proposal.", 409);
  }
  return inspectPayment(context, id);
}

/**
 * Dev-only test signer: marks this session's exact pending USDC transfer as
 * claimed, once, and returns its approved fee quote. PIN requests are never claimed.
 */
export async function claimTestSignerPayment(binding: string, calls: readonly { to: string; data?: string; value?: string }[]) {
  const { data } = await admin().from("payment_proposals").select("*").eq("binding", binding).eq("state", "AWAITING_SIGNATURE").is("tx_hash", null);
  for (const row of data ?? []) {
    const pending = paymentPendingSchema.safeParse(row.pending);
    const fee = (row.proposal as PaymentProposal).feeQuote;
    if (!pending.success || pending.data.challengeId || pending.data.testSignerClaimed || !fee || fee.source !== "ARC_EOA" || Date.parse(fee.expiresAt) <= Date.now() || calls.length !== 1) continue;
    const expected = pending.data.calls[0];
    if (calls[0].to.toLowerCase() !== expected.to.toLowerCase() || (calls[0].data ?? "0x").toLowerCase() !== expected.data.toLowerCase() || (calls[0].value ?? "0") !== "0") continue;
    const { data: claimed } = await admin().from("payment_proposals").update({ pending: { ...pending.data, testSignerClaimed: true } }).eq("id", row.id).eq("state", "AWAITING_SIGNATURE").eq("pending->>id", pending.data.id).is("tx_hash", null).select("id");
    if (!claimed?.length) continue;
    return { call: { to: expected.to as `0x${string}`, data: expected.data as `0x${string}`, value: expected.value }, feeQuote: fee };
  }
  throw new EarnAccessError("TEST_SIGNER_REQUEST_NOT_FOUND", "No matching pending payment signature request for this session.", 409);
}

export async function inspectPayment(context: PaymentContext, id: string, recovery = false) {
  const { row, record } = await readPayment(context, id, recovery);
  const pending = pendingOf(row);
  const visible = record.state === "AWAITING_SIGNATURE" && pending && !answered(row, pending) && row.binding === context.binding ? pending : null;
  return { status: "READY" as const, record, pending: visible ? { id: visible.id, calls: visible.calls, gasBudgetWei: visible.gasBudgetWei, ...(visible.gasCeiling ? { gasCeiling: visible.gasCeiling } : {}), ...(visible.challengeId ? { challengeId: visible.challengeId } : {}), expiresAt: visible.expiresAt } : null };
}

export async function replyPayment(context: PaymentContext, id: string, input: { requestId: string; txHash?: string; userOperationHash?: string; cancelled?: boolean; uncertain?: boolean; challengeApproved?: boolean }) {
  const { row, record } = await readPayment(context, id); arcOnly(record.proposal); const pending = pendingOf(row);
  // A passkey reports its UserOperation first and the mined hash after it.
  const lateHash = pending?.id === input.requestId && input.txHash && !row.tx_hash && ["AWAITING_SIGNATURE", "SUBMITTED"].includes(record.state) && row.user_operation_hash;
  if (!pending || pending.id !== input.requestId || (!lateHash && (record.state !== "AWAITING_SIGNATURE" || answered(row, pending)))) throw new EarnAccessError("REQUEST_ALREADY_ANSWERED", "The signature request is unavailable or already answered.", 409);
  const update = (values: Record<string, unknown>) => admin().from("payment_proposals").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).in("state", ["AWAITING_SIGNATURE", "SUBMITTED"]);
  if (pending.challengeId) {
    if (input.txHash || input.userOperationHash || (!input.cancelled && !input.challengeApproved)) throw new EarnAccessError("INVALID_PIN_REPLY", "PIN replies cannot supply a transaction hash.", 400);
    if (input.cancelled) await update({ state: "UNKNOWN" });
    else await update({ pending: { ...pending, challengeApproved: true } });
  } else if (input.challengeApproved) throw new EarnAccessError("INVALID_PIN_REPLY", "This request requires browser-wallet signing.", 400);
  else if (input.userOperationHash) {
    if (context.wallet.provider !== "CIRCLE_MODULAR" || !record.proposal.feeQuote?.userOperation || input.txHash || input.cancelled) throw new EarnAccessError("INVALID_USER_OPERATION", "Only the selected passkey operation can report a UserOperation hash.", 400);
    const { error } = await admin().from("payment_proposals").update({ user_operation_hash: input.userOperationHash, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).eq("state", "AWAITING_SIGNATURE").is("user_operation_hash", null);
    if (error) throw new Error("USER_OPERATION_RECORD_UNAVAILABLE");
  } else if (input.cancelled) {
    // The dev signer is the server itself: an unclaimed request was provably never signed.
    const neverSigned = context.wallet.provider === "TEST_SIGNER" && !pending.testSignerClaimed;
    if (input.uncertain && !neverSigned) await update({ state: "UNKNOWN" });
    else await admin().rpc("hodd_cancel_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding, p_state: "FAILED" });
  } else if (input.txHash) {
    const { error } = await update({ state: "SUBMITTED", tx_hash: input.txHash });
    if (error) throw new Error("SUBMISSION_RECORD_UNAVAILABLE");
  } else throw new EarnAccessError("INVALID_REQUEST", "A valid signature reply is required.", 400);
  return advancePayment(context, id);
}

/** The hash a signer produced for this payment, when it can be resolved yet. */
async function resolveHash(context: PaymentContext, row: Row, proposal: PaymentProposal, pending: Pending | null): Promise<`0x${string}` | null> {
  if (row.tx_hash) return row.tx_hash as `0x${string}`;
  try {
    if (row.user_operation_hash && context.wallet.provider === "CIRCLE_MODULAR") return await resolvePaymentUserOperation(proposal, row.user_operation_hash) as `0x${string}`;
    if (pending?.challengeId && pending.challengeApproved) {
      const circle = circleUserWalletClient();
      if (!circle || !context.userToken) return null;
      const { data } = await circle.getUserChallenge({ challengeId: pending.challengeId, userToken: context.userToken });
      const transactionId = data?.challenge?.correlationIds?.[0];
      if (!transactionId) return null;
      const transaction = (await circle.getTransaction({ id: transactionId, userToken: context.userToken })).data?.transaction;
      return transaction?.txHash && /^0x[\da-fA-F]{64}$/.test(transaction.txHash) ? transaction.txHash as `0x${string}` : null;
    }
  } catch { /* not resolvable yet */ }
  return null;
}

/** STATUS: resolve and verify a submission; an unanswered request past its deadline becomes UNKNOWN. */
export async function advancePayment(context: PaymentContext, id: string, candidateHash?: string, recovery = false) {
  const { row, record } = await readPayment(context, id, recovery); arcOnly(record.proposal); const pending = pendingOf(row);
  if (record.txHash && candidateHash && record.txHash.toLowerCase() !== candidateHash.toLowerCase()) throw new EarnAccessError("RECEIPT_HASH_MISMATCH", "This payment is already bound to a different submitted hash.", 409);
  if (["AWAITING_SIGNATURE", "SUBMITTED", "UNKNOWN"].includes(record.state)) {
    const hash = (await resolveHash(context, row, record.proposal, pending)) ?? (candidateHash as `0x${string}` | undefined) ?? null;
    if (hash) {
      if (!row.tx_hash) await admin().from("payment_proposals").update({ state: "SUBMITTED", tx_hash: hash, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).in("state", ["AWAITING_SIGNATURE", "SUBMITTED", "UNKNOWN"]).is("tx_hash", null);
      try { await settlePayment(context, record.proposal, hash); }
      catch { await admin().from("payment_proposals").update({ state: "UNKNOWN", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).in("state", ["AWAITING_SIGNATURE", "SUBMITTED"]); }
    } else if (record.state === "AWAITING_SIGNATURE" && pending && !answered(row, pending) && Date.parse(pending.expiresAt) + SIGNATURE_GRACE_MS < Date.now()) {
      // A wallet can still broadcast a late transfer: never release automatically.
      await admin().from("payment_proposals").update({ state: "UNKNOWN", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).eq("state", "AWAITING_SIGNATURE").is("tx_hash", null);
    }
  }
  return inspectPayment(context, id, recovery);
}

/**
 * Releases an expired payment only with proof nothing was sent: the wallet's
 * nonce is unchanged (and the user confirms the wallet request was closed), or
 * Circle reports the PIN challenge as failed or expired.
 */
export async function recoverPayment(context: PaymentContext, id: string, acknowledged: boolean) {
  const { row, record } = await readPayment(context, id, true); arcOnly(record.proposal); const pending = pendingOf(row);
  if (!["AWAITING_SIGNATURE", "UNKNOWN"].includes(record.state) || row.tx_hash || row.user_operation_hash || !pending || Date.parse(record.proposal.expiresAt) > Date.now()) throw new EarnAccessError("RECOVERY_NOT_AVAILABLE", "Only an expired payment without any reported submission can be released.", 409);
  let proof: Record<string, string> | null = null;
  if (pending.challengeId) {
    const circle = circleUserWalletClient();
    const status = circle && context.userToken ? (await circle.getUserChallenge({ challengeId: pending.challengeId, userToken: context.userToken })).data?.challenge?.status : null;
    if (status === "FAILED" || status === "EXPIRED") proof = { kind: "CIRCLE_CHALLENGE", status };
  } else if (acknowledged && pending.nonce) {
    if (context.wallet.accountType === "EOA") {
      const address = getAddress(context.wallet.address);
      const [latest, mempool] = await Promise.all([arcClient.getTransactionCount({ address, blockTag: "latest" }), arcClient.getTransactionCount({ address, blockTag: "pending" })]);
      if (BigInt(latest) === BigInt(pending.nonce) && BigInt(mempool) === BigInt(pending.nonce)) proof = { kind: "EOA_NONCE", nonce: pending.nonce };
    } else if (context.wallet.provider === "CIRCLE_MODULAR" && (await (await modularReadClient(context.wallet)).account.getNonce()) === BigInt(pending.nonce)) proof = { kind: "MSCA_NONCE", nonce: pending.nonce };
  }
  if (!proof) throw new EarnAccessError("RECOVERY_NOT_PROVEN", "Hodd cannot prove that nothing was sent. Paste the transaction hash to verify it instead.", 409);
  const { error } = await admin().rpc("hodd_release_unsubmitted_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_proof: { ...proof, releasedAt: new Date().toISOString() } });
  if (error) throw new EarnAccessError("RECOVERY_NOT_AVAILABLE", "The payment could not be released. It stays held for review.", 409);
  return inspectPayment(context, id, true);
}
