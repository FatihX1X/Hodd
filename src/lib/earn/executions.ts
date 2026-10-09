import "server-only";
import { randomUUID } from "node:crypto";
import { erc20Abi, getAddress } from "viem";
import { z } from "zod";
import { circleUserWalletClient } from "@/lib/circle/user-wallet-server";
import { paymentAdmin } from "@/lib/payments/admin";
import { walletConnectionSchema } from "@/lib/treasury/models";
import { modularReadClient } from "@/lib/wallet/modular-server";
import { assertLiveReady } from "@/lib/execution/live-readiness";
import type { ExecutionMode } from "./access-policy";
import { captureNextEarnCall, EarnCaptureError } from "./capture";
import { safeEarnFailure } from "./diagnostics";
import { arcClient, getEarnPosition } from "./gateway";
import { quotedSigningGasPrice } from "./gas";
import { earnExecutionResultSchema, earnQuoteSchema, type EarnQuote } from "./models";
import { nativeWeiToUsdcCeil } from "./money";
import { recordEarnEvidence } from "./provider-evidence";
import { verifyApprovalReceipt, verifyEarnReceipt } from "./receipts";
import { validateEarnCall } from "./router";
import { EarnAccessError } from "./security";
import { assertEarnContextCurrent } from "./server-context";
import { assessEarnOperation } from "./server-policy";
import { freshEarnInputs, type EarnContext } from "./server-quotes";

const hash32 = z.string().regex(/^0x[\da-fA-F]{64}$/);
const integer = z.string().regex(/^\d+$/);
const pendingSchema = z.object({
  id: z.string().uuid(), stage: z.enum(["APPROVAL", "EARN"]),
  calls: z.array(z.object({ to: z.string(), data: z.string(), value: integer })).length(1),
  gasBudgetWei: integer, gasCeiling: z.object({ gasLimit: integer, gasPriceWei: integer }).optional(),
  challengeId: z.string().optional(), expiresAt: z.string().datetime(), nonce: integer.optional(),
  txHash: hash32.optional(), userOperationHash: hash32.optional(), challengeApproved: z.boolean().optional(), testSignerClaimed: z.boolean().optional(),
});
const failureSchema = z.object({ code: z.string(), stage: z.string(), providerCode: z.string().optional() });
const rowSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), scope: z.enum(["TREASURY", "SMOKE_TEST"]), wallet_address: z.string(), wallet: walletConnectionSchema,
  binding: z.string(), policy_digest: z.string(), quote: earnQuoteSchema,
  state: z.enum(["PREPARING", "AWAITING_SIGNATURE", "SUBMITTED", "COMPLETE", "PARTIAL", "FAILED", "UNKNOWN"]),
  approvals: z.number().int(), started_block: integer, gas_spent_wei: integer, pending: pendingSchema.nullable(),
  events: z.array(z.object({ stage: z.string(), hash: hash32.optional() })), result: earnExecutionResultSchema.nullable(), failure: failureSchema.nullable(), version: z.number().int(),
});
type Row = z.infer<typeof rowSchema>;
type Pending = z.infer<typeof pendingSchema>;
type Patch = Partial<Pick<Row, "state" | "approvals" | "gas_spent_wei" | "pending" | "events" | "result" | "failure">>;
export type EarnReply = Readonly<{ requestId: string; txHash?: string; userOperationHash?: string; challengeApproved?: boolean; cancelled?: boolean; uncertain?: boolean }>;
export type EarnRecovery = Readonly<{ candidateTxHash?: string; acknowledgeNoPendingTransaction?: boolean }>;

const SIGNATURE_GRACE_MS = 60_000;
const terminal = (state: Row["state"]) => state === "COMPLETE" || state === "PARTIAL" || state === "FAILED";
const db = () => paymentAdmin();
export const gasReserveWei = (quote: EarnQuote) => quote.gasFees.reduce((sum, item) => {
  if (!item.amount) throw new Error("GAS_RESERVE_UNAVAILABLE");
  return sum + BigInt(item.amount.minorUnits) * 10n ** 12n;
}, 0n);
const answered = (pending: Pending) => Boolean(pending.txHash || pending.userOperationHash || pending.challengeApproved);

async function load(context: EarnContext, id: string, recovery = false): Promise<Row> {
  const { data, error } = await db().from("earn_executions").select("*").eq("id", id).eq("user_id", context.userId).eq("scope", context.scope).maybeSingle();
  if (error) throw new EarnAccessError("EXECUTION_STATUS_UNAVAILABLE", "Execution status is unavailable. Inspect the explorer; do not resubmit automatically.", 503);
  const parsed = data ? rowSchema.safeParse(data) : null;
  // A new session can recover its own wallet's execution, never another wallet's.
  if (!parsed?.success || parsed.data.wallet_address !== context.wallet.address.toLowerCase() || (!recovery && parsed.data.binding !== context.binding)) throw new EarnAccessError("EXECUTION_NOT_FOUND", "This execution is unavailable in the current wallet session.", 404);
  return parsed.data;
}

/** Compare-and-set on `version`; null means another request advanced first. */
async function write(row: Row, patch: Patch): Promise<Row | null> {
  const { data, error } = await db().from("earn_executions").update({ ...patch, version: row.version + 1, updated_at: new Date().toISOString() }).eq("id", row.id).eq("version", row.version).select("*");
  if (error) throw new Error("EXECUTION_STORE_UNAVAILABLE");
  return data?.length ? rowSchema.parse(data[0]) : null;
}
const withEvent = (row: Row, stage: string, hash?: string) => [...row.events, { stage, ...(hash ? { hash } : {}) }];
const fail = (row: Row, failure: z.infer<typeof failureSchema>, state: "FAILED" | "UNKNOWN" = "FAILED") => write(row, { state, failure, events: withEvent(row, state) });

/** Browser-facing view; a pending call is shown only while it awaits a signature. */
export function executionView(row: Row) {
  const pending = row.state === "AWAITING_SIGNATURE" && row.pending && !answered(row.pending) ? row.pending : null;
  return { status: "PENDING" as const, executionId: row.id, state: row.state, events: row.events,
    pending: pending ? { id: pending.id, stage: pending.stage, calls: pending.calls, gasBudgetWei: pending.gasBudgetWei, ...(pending.gasCeiling ? { gasCeiling: pending.gasCeiling } : {}), ...(pending.challengeId ? { challengeId: pending.challengeId } : {}), expiresAt: pending.expiresAt } : null,
    result: row.result, failure: row.failure ? { code: row.failure.code, stage: row.failure.stage, ...(row.failure.providerCode ? { providerCode: row.failure.providerCode } : {}) } : null };
}

export async function startEarnExecution(context: EarnContext, mode: ExecutionMode, quoteId: string, acknowledged: boolean) {
  await assertLiveReady(context, mode, "START");
  const { data: stored, error } = await db().from("earn_quotes").select("quote,binding,policy_digest,expires_at,consumed_at").eq("id", quoteId).eq("user_id", context.userId).eq("scope", context.scope).maybeSingle();
  if (error) throw new EarnAccessError("QUOTE_STORE_UNAVAILABLE", "The quote store is unavailable. Nothing was submitted.", 503);
  if (!stored || stored.binding !== context.binding || stored.consumed_at || Date.parse(stored.expires_at) <= Date.now()) throw new EarnAccessError("QUOTE_NOT_AVAILABLE", "The quote expired, was consumed or belongs to another session.", 409);
  if (stored.policy_digest !== context.policyDigest) throw new EarnAccessError("WORKSPACE_CHANGED", "Request a new quote after changing your workspace.", 409);
  const quote = earnQuoteSchema.parse(stored.quote);
  if (quote.requiresWarningAcknowledgement && !acknowledged) throw new EarnAccessError("WARNINGS_NOT_ACKNOWLEDGED", "Acknowledge the quote warnings first.", 409);
  const live = await freshEarnInputs(context, quote.vaultAddress);
  const liveWarnings = [...live.vault.earnKitWarnings, ...live.vault.warnings.map((item) => `${item.level}: ${item.type}`)];
  if (liveWarnings.some((warning) => !quote.warnings.includes(warning))) throw new EarnAccessError("WARNINGS_CHANGED", "New vault warnings require a new quote and explicit acknowledgement.", 409);
  const policy = assessEarnOperation(live.workspace, live.positions, quote.operation, quote.amount, quote.fees);
  if (policy.status === "BLOCKED" || (quote.operation !== "DEPOSIT" && BigInt(quote.amount.minorUnits) > BigInt(live.position.redeemable.minorUnits))) throw new EarnAccessError("POLICY_BLOCKED", "Fresh treasury policy or liquidity no longer permits this quote.", 409);
  const startedBlock = await arcClient.getBlockNumber();
  const { error: startError } = await db().rpc("hodd_start_earn_execution", { p_user: context.userId, p_scope: context.scope, p_quote: quoteId, p_binding: context.binding, p_policy_digest: context.policyDigest, p_ack: acknowledged, p_wallet: context.wallet, p_started_block: startedBlock.toString() });
  if (startError) {
    if (/wallet busy/i.test(startError.message)) throw new EarnAccessError("WALLET_BUSY", "Another Earn or payment execution on this wallet needs completion or review.", 409);
    if (/earn_one_active_user/i.test(startError.message)) throw new EarnAccessError("EXECUTION_IN_PROGRESS", "Finish or review your open Earn execution first.", 409);
    throw new EarnAccessError("QUOTE_NOT_AVAILABLE", "The quote expired, was consumed or needs warning acknowledgement.", 409);
  }
  return advanceEarnExecution(context, mode, quoteId);
}

/** Applies an optional browser reply, then moves the execution as far as it can. */
export async function advanceEarnExecution(context: EarnContext, _mode: ExecutionMode, id: string, reply?: EarnReply, recovery?: EarnRecovery) {
  let row = await load(context, id, Boolean(recovery));
  if (reply) row = await applyReply(row, reply);
  if (recovery) row = await applyRecovery(row, recovery);
  for (let step = 0; step < 4 && !terminal(row.state); step++) {
    const next = await progress(context, row);
    if (!next) break;
    row = next;
  }
  return executionView(row);
}

async function reload(row: Row) {
  const { data } = await db().from("earn_executions").select("*").eq("id", row.id).single();
  return rowSchema.parse(data);
}

async function applyReply(row: Row, reply: EarnReply): Promise<Row> {
  const pending = row.pending;
  // The passkey flow reports its UserOperation first and the mined hash after it.
  const lateHash = row.state === "SUBMITTED" && pending?.id === reply.requestId && !pending.txHash && reply.txHash;
  if (!pending || pending.id !== reply.requestId || (!lateHash && (row.state !== "AWAITING_SIGNATURE" || answered(pending)))) throw new EarnAccessError("SIGNATURE_REQUEST_NOT_AVAILABLE", "The signature request was already answered.", 409);
  let next: Row | null;
  if (reply.cancelled) {
    // The dev signer is the server itself: an unclaimed request was provably never signed.
    const neverSigned = row.wallet.provider === "TEST_SIGNER" && !pending.testSignerClaimed;
    const state = reply.uncertain && !neverSigned ? "UNKNOWN" : "FAILED";
    next = await write(row, { state, failure: { code: "USER_CANCELLED", stage: "SIGNING_PREPARATION" }, events: withEvent(row, state === "FAILED" ? "USER_CANCELLED" : "UNKNOWN") });
  } else if (reply.challengeApproved) {
    if (!pending.challengeId) throw new EarnAccessError("INVALID_PIN_REPLY", "This request requires browser-wallet signing.", 400);
    next = await write(row, { state: "SUBMITTED", pending: { ...pending, challengeApproved: true }, events: withEvent(row, `${pending.stage}_PIN_APPROVED`) });
  } else if (reply.userOperationHash) {
    if (row.wallet.provider !== "CIRCLE_MODULAR") throw new EarnAccessError("INVALID_USER_OPERATION", "Only a passkey wallet reports a UserOperation hash.", 400);
    next = await write(row, { state: "SUBMITTED", pending: { ...pending, userOperationHash: reply.userOperationHash }, events: withEvent(row, "USER_OPERATION_SUBMITTED", reply.userOperationHash) });
  } else if (reply.txHash) {
    next = await write(row, { state: "SUBMITTED", pending: { ...pending, txHash: reply.txHash }, events: withEvent(row, "TRANSACTION_SUBMITTED", reply.txHash) });
  } else throw new EarnAccessError("INVALID_REQUEST", "A valid signature reply is required.", 400);
  return next ?? reload(row);
}

/** UNKNOWN only moves with evidence: a candidate hash, or an unchanged nonce the user confirms. */
async function applyRecovery(row: Row, recovery: EarnRecovery): Promise<Row> {
  if (row.state !== "UNKNOWN" || !row.pending) throw new EarnAccessError("RECOVERY_NOT_AVAILABLE", "Only an execution with an unknown outcome can be recovered.", 409);
  if (recovery.candidateTxHash) return await write(row, { state: "SUBMITTED", pending: { ...row.pending, txHash: recovery.candidateTxHash }, events: withEvent(row, "TRANSACTION_REPORTED", recovery.candidateTxHash) }) ?? reload(row);
  if (!recovery.acknowledgeNoPendingTransaction || answered(row.pending) || !await nonceUnchanged(row, row.pending)) throw new EarnAccessError("RECOVERY_NOT_PROVEN", "The wallet nonce changed or a submission was reported. Paste the transaction hash to verify it instead.", 409);
  return await write(row, { state: "FAILED", failure: { code: "NOT_SUBMITTED", stage: "RECOVERY" }, events: withEvent(row, "RELEASED_UNCHANGED_NONCE") }) ?? reload(row);
}

async function nonceUnchanged(row: Row, pending: Pending) {
  if (!pending.nonce) return false;
  try {
    if (row.wallet.accountType === "EOA") {
      const address = getAddress(row.wallet.address);
      const [latest, mempool] = await Promise.all([arcClient.getTransactionCount({ address, blockTag: "latest" }), arcClient.getTransactionCount({ address, blockTag: "pending" })]);
      return BigInt(latest) === BigInt(pending.nonce) && BigInt(mempool) === BigInt(pending.nonce);
    }
    if (row.wallet.provider === "CIRCLE_MODULAR") return (await (await modularReadClient(row.wallet)).account.getNonce()) === BigInt(pending.nonce);
  } catch { /* unprovable */ }
  return false;
}

async function progress(context: EarnContext, row: Row): Promise<Row | null> {
  if (row.state === "PREPARING") return prepareNext(context, row);
  if (row.state === "SUBMITTED") return settleSubmitted(context, row);
  if (row.state === "AWAITING_SIGNATURE" && row.pending && !answered(row.pending) && Date.parse(row.pending.expiresAt) + SIGNATURE_GRACE_MS < Date.now()) return expirePending(context, row, row.pending);
  return null;
}

/** An unanswered request past its deadline. Earn requests are safe to close:
 * a late router call reverts on its signed deadline, a late approval is bounded. */
async function expirePending(context: EarnContext, row: Row, pending: Pending) {
  if (pending.challengeId) {
    const status = await challengeStatus(context, pending.challengeId).catch(() => null);
    if (status === "COMPLETE") return write(row, { state: "SUBMITTED", pending: { ...pending, challengeApproved: true }, events: withEvent(row, `${pending.stage}_PIN_APPROVED`) });
    return fail(row, { code: "SIGNATURE_TIMEOUT", stage: "SIGNING_PREPARATION" }, status === "FAILED" || status === "EXPIRED" ? "FAILED" : "UNKNOWN");
  }
  const neverSigned = row.wallet.provider === "TEST_SIGNER" && !pending.testSignerClaimed;
  return fail(row, { code: "SIGNATURE_TIMEOUT", stage: "SIGNING_PREPARATION" }, neverSigned || await nonceUnchanged(row, pending) ? "FAILED" : "UNKNOWN");
}

async function challengeStatus(context: EarnContext, challengeId: string) {
  const circle = circleUserWalletClient();
  if (!circle || !context.userToken) return null;
  const { data } = await circle.getUserChallenge({ challengeId, userToken: context.userToken });
  return data?.challenge?.status ?? null;
}

/** The mined hash for the answered request, or null while it is not known yet. */
async function resolveSubmission(context: EarnContext, row: Row, pending: Pending): Promise<`0x${string}` | null> {
  if (pending.txHash) return pending.txHash as `0x${string}`;
  try {
    if (pending.userOperationHash) {
      const { bundler } = await modularReadClient(row.wallet);
      return (await bundler.getUserOperationReceipt({ hash: pending.userOperationHash as `0x${string}` })).receipt.transactionHash;
    }
    if (pending.challengeId && pending.challengeApproved) {
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

async function settleSubmitted(context: EarnContext, row: Row): Promise<Row | null> {
  const pending = row.pending;
  if (!pending) return fail(row, { code: "EXECUTION_REQUIRES_REVIEW", stage: "RECEIPT_VERIFICATION" }, "UNKNOWN");
  const hash = await resolveSubmission(context, row, pending);
  if (!hash) return null;
  let receipt;
  try { receipt = await arcClient.getTransactionReceipt({ hash }); } catch { return null; }
  const call = pending.calls[0];
  try {
    if (receipt.blockNumber <= BigInt(row.started_block)) throw new Error("TRANSACTION_NOT_VERIFIED");
    let gasSpent = BigInt(row.gas_spent_wei);
    if (row.wallet.accountType === "EOA") {
      const transaction = await arcClient.getTransaction({ hash });
      if (transaction.from.toLowerCase() !== row.wallet.address.toLowerCase() || transaction.to?.toLowerCase() !== call.to.toLowerCase() || transaction.input.toLowerCase() !== call.data.toLowerCase() || transaction.value !== BigInt(call.value)) throw new Error("TRANSACTION_PAYLOAD_MISMATCH");
      gasSpent += receipt.gasUsed * receipt.effectiveGasPrice;
    }
    // Mined and provably this request: nothing is in flight, so these close as FAILED.
    if (receipt.status !== "success") return fail(row, { code: "RECEIPT_REVERTED", stage: "RECEIPT_VERIFICATION" });
    if (gasSpent > gasReserveWei(row.quote)) return fail(row, { code: "FEE_RESERVE_EXCEEDED", stage: "RECEIPT_VERIFICATION" });
    if (pending.stage === "APPROVAL") verifyApprovalReceipt(receipt, { to: call.to as `0x${string}`, data: call.data as `0x${string}`, value: BigInt(call.value) }, row.wallet.address);
    else verifyEarnReceipt(receipt, row.quote);
    const { error } = await db().from("earn_execution_receipts").insert({ tx_hash: hash.toLowerCase(), wallet_address: row.wallet_address, execution_id: row.id, stage: pending.stage });
    if (error) {
      // An earlier attempt of this same step may have recorded it before a crash.
      const { data: existing } = await db().from("earn_execution_receipts").select("execution_id,stage").eq("tx_hash", hash.toLowerCase()).eq("wallet_address", row.wallet_address).maybeSingle();
      if (existing?.execution_id !== row.id || existing.stage !== pending.stage) throw new Error("TRANSACTION_NOT_VERIFIED");
    }
    if (pending.stage === "APPROVAL") return write(row, { state: "PREPARING", approvals: row.approvals + 1, gas_spent_wei: gasSpent.toString(), pending: null, events: withEvent(row, "APPROVAL_CONFIRMED", hash) });
    const live = await freshEarnInputs(context, row.quote.vaultAddress);
    const residual = await getEarnPosition(row.wallet.address, live.vault);
    const status = row.quote.operation === "REDEEM_ALL" && /[1-9]/.test(residual.shares) ? "PARTIAL" : "COMPLETE";
    const result = earnExecutionResultSchema.parse({ executionId: row.id, operation: row.quote.operation, status, txHash: receipt.transactionHash, explorerUrl: `https://testnet.arcscan.app/tx/${receipt.transactionHash}`, vaultAddress: row.quote.vaultAddress, amount: row.quote.amount, residualPosition: residual });
    const done = await write(row, { state: status, gas_spent_wei: gasSpent.toString(), pending: null, result, events: withEvent(row, status, receipt.transactionHash) });
    if (done) await recordEarnEvidence(context, row.quote, result, BigInt(row.started_block), receipt.blockNumber).catch(() => undefined);
    return done;
  } catch (error) {
    // Mined but not provably this request: keep the wallet lease for review.
    return fail(row, safeEarnFailure(error, "RECEIPT_VERIFICATION"), "UNKNOWN");
  }
}

async function prepareNext(context: EarnContext, row: Row): Promise<Row | null> {
  if (!row.quote.expiresAt || Date.parse(row.quote.expiresAt) <= Date.now()) return fail(row, { code: "QUOTE_EXPIRED_OR_CANCELLED", stage: "SIGNING_PREPARATION" });
  // Claim the step first so concurrent polls do not prepare it twice.
  const locked = await write(row, {});
  if (!locked) return null;
  try {
    if (locked.policy_digest !== context.policyDigest) throw new Error("WORKSPACE_CHANGED");
    await assertEarnContextCurrent(context);
    await assertFreshPolicy(context, locked);
    let captured = await captureNextEarnCall(locked.quote, locked.wallet.address);
    // A load-balanced RPC replica can lag a just-confirmed approval.
    for (let attempt = 0; captured.stage === "APPROVAL" && locked.approvals > 0 && attempt < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      captured = await captureNextEarnCall(locked.quote, locked.wallet.address);
    }
    if (captured.stage === "APPROVAL" && locked.approvals >= 2) throw new Error("APPROVAL_NOT_VERIFIED");
    const wallet = getAddress(locked.wallet.address);
    const shareBalance = locked.quote.operation === "DEPOSIT" ? undefined : await arcClient.readContract({ address: getAddress(locked.quote.vaultAddress), abi: erc20Abi, functionName: "balanceOf", args: [wallet] });
    const checked = validateEarnCall(captured.call, locked.quote, wallet, { shareBalance });
    const remaining = gasReserveWei(locked.quote) - BigInt(locked.gas_spent_wei);
    if (remaining <= 0n) throw new Error("FEE_RESERVE_EXHAUSTED");
    const deadlineMs = checked.deadline ? Number(checked.deadline) * 1000 - 30_000 : Infinity;
    const expiresAt = new Date(Math.min(Date.parse(locked.quote.expiresAt!), deadlineMs)).toISOString();
    const pending: Pending = { id: randomUUID(), stage: captured.stage, calls: [captured.call], gasBudgetWei: remaining.toString(), expiresAt };
    if (locked.wallet.accountType === "EOA") {
      const fee = locked.quote.gasFees.find((item) => captured.stage === "APPROVAL" ? /^approv/i.test(item.name) : item.name.toLowerCase() === (locked.quote.operation === "DEPOSIT" ? "deposit" : "withdraw"));
      if (!fee?.gasLimit || !fee.maxGasPriceWei) throw new Error("FEE_CEILING_UNAVAILABLE");
      const gasLimit = BigInt(fee.gasLimit);
      const [gasPriceWei, estimate, nonce] = await Promise.all([
        arcClient.getGasPrice().catch(() => { throw new Error("GAS_PRICE_UNAVAILABLE"); }).then((price) => quotedSigningGasPrice(price, BigInt(fee.maxGasPriceWei!))),
        arcClient.estimateGas({ account: wallet, to: captured.call.to, data: captured.call.data, value: BigInt(captured.call.value) }).catch(() => { throw new Error("GAS_ESTIMATE_UNAVAILABLE"); }),
        arcClient.getTransactionCount({ address: wallet, blockTag: "pending" }),
      ]);
      if (estimate > gasLimit || gasLimit * gasPriceWei > remaining) throw new Error("FEE_RESERVE_EXCEEDED");
      pending.gasCeiling = { gasLimit: gasLimit.toString(), gasPriceWei: gasPriceWei.toString() };
      pending.nonce = BigInt(nonce).toString();
    } else if (locked.wallet.provider === "CIRCLE_MODULAR") {
      pending.nonce = (await (await modularReadClient(locked.wallet)).account.getNonce()).toString();
    } else if (locked.wallet.provider === "CIRCLE_USER_CONTROLLED") {
      const circle = circleUserWalletClient();
      if (!circle || !context.userToken || !locked.wallet.walletId) throw new Error("EMBEDDED_SESSION_REQUIRED");
      // Circle requires a fee level for SCA wallets; the reserve is enforced by policy.
      const { data } = await circle.createUserTransactionContractExecutionChallenge({ userToken: context.userToken, walletId: locked.wallet.walletId, contractAddress: captured.call.to, callData: captured.call.data, fee: { type: "level", config: { feeLevel: "MEDIUM" } }, idempotencyKey: pending.id });
      if (!data?.challengeId) throw new Error("ENCODED_CALL_REQUIRED");
      pending.challengeId = data.challengeId;
    }
    return await write(locked, { state: "AWAITING_SIGNATURE", pending, events: withEvent(locked, `${captured.stage}_${pending.challengeId ? "PIN" : "SIGNATURE"}_REQUESTED`) });
  } catch (error) {
    // Nothing is in flight while preparing; closing releases the wallet lease.
    return fail(locked, error instanceof EarnCaptureError ? error.failure : safeEarnFailure(error, "SIGNING_PREPARATION"));
  }
}

async function assertFreshPolicy(context: EarnContext, row: Row) {
  const live = await freshEarnInputs(context, row.quote.vaultAddress);
  const fees = nativeWeiToUsdcCeil((BigInt(row.quote.fees.minorUnits) * 10n ** 12n - BigInt(row.gas_spent_wei)).toString());
  const policy = assessEarnOperation(live.workspace, live.positions, row.quote.operation, row.quote.amount, fees);
  if (policy.status === "BLOCKED" || BigInt(fees.minorUnits) > BigInt(live.workspace.liquidUsdc.minorUnits) || (row.quote.operation !== "DEPOSIT" && BigInt(row.quote.amount.minorUnits) > BigInt(live.position.redeemable.minorUnits))) throw new Error("FRESH_POLICY_BLOCKED");
}

/**
 * Dev-only test signer: marks this session's exact pending Earn request as
 * claimed, once, and returns its server-bound gas ceiling.
 */
export async function claimTestSignerEarnRequest(binding: string, call: { to: string; data?: string; value?: string }, ceiling: { gasLimit: string; gasPriceWei: string }) {
  const { data } = await db().from("earn_executions").select("*").eq("binding", binding).eq("state", "AWAITING_SIGNATURE");
  for (const raw of data ?? []) {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) continue;
    const row = parsed.data; const pending = row.pending;
    if (!pending || answered(pending) || pending.testSignerClaimed || pending.challengeId || !pending.gasCeiling || Date.parse(pending.expiresAt) <= Date.now()) continue;
    const expected = pending.calls[0];
    if (expected.to.toLowerCase() !== call.to.toLowerCase() || expected.data.toLowerCase() !== (call.data ?? "0x").toLowerCase() || expected.value !== (call.value ?? "0") || pending.gasCeiling.gasLimit !== ceiling.gasLimit || pending.gasCeiling.gasPriceWei !== ceiling.gasPriceWei) continue;
    if (!await write(row, { pending: { ...pending, testSignerClaimed: true } })) continue;
    return { call: { to: expected.to as `0x${string}`, data: expected.data as `0x${string}`, value: expected.value }, gasCeiling: pending.gasCeiling };
  }
  throw new EarnAccessError("TEST_SIGNER_REQUEST_NOT_FOUND", "No matching pending Earn signature request for this session.", 409);
}
