import "server-only";
import { randomUUID } from "node:crypto";
import { getAddress } from "viem";
import { z } from "zod";
import { isExecutionAvailable, type ExecutionMode } from "@/lib/earn/access-policy";
import { arcClient } from "@/lib/earn/gateway";
import { EarnAccessError } from "@/lib/earn/security";
import { assertLiveAmount, assertLiveReady } from "@/lib/execution/live-readiness";
import { paymentAdmin } from "@/lib/payments/admin";
import { paymentProposalSchema, type PaymentProposal } from "@/lib/payments/models";
import { paymentRecipient } from "@/lib/payments/policy";
import { readPayment, type PaymentContext } from "@/lib/payments/server";
import { obligationSchema, type Obligation, type PolicyResult, type TreasuryWorkspace } from "@/lib/treasury/models";
import { GatewayApiError, estimateForwardedTransfer, gatewayBalances, gatewayTransferStatus, submitForwardedTransfer } from "./api";
import { gatewayChainByKey } from "./chains";
import { buildArcTransferSpec, burnIntentSchema, burnIntentTypedDataJson } from "./intent";
import { assertGatewaySigner, verifyIntentSignature } from "./moves";
import { findGatewayMint, verifyGatewayMint } from "./receipts";

// Pays an obligation from the user's Circle Gateway balance on any supported
// chain: Gateway mints the exact amount straight to the obligation's Arc
// recipient (verified live on 2026-10-10, see docs/gateway-validation.md).
// It reuses the payment ledger, so PAID still requires a verified Arc receipt.
const SIGN_TTL_MS = 5 * 60_000;
const admin = () => paymentAdmin();
const usdc = (minor: bigint | string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits: minor.toString() });
export const gatewayPendingSchema = z.object({ id: z.string().uuid(), kind: z.literal("GATEWAY_INTENT"), intent: burnIntentSchema, expiresAt: z.string().datetime(), signature: z.string().regex(/^0x[\da-fA-F]+$/).optional() });
type GatewayPending = z.infer<typeof gatewayPendingSchema>;

/** Paying from Gateway never touches the Arc wallet, so only the obligation itself and the Gateway balance are checked. */
export function assessGatewayPayment(workspace: TreasuryWorkspace, obligation: Obligation, availableMinor: bigint, requiredMinor: bigint, sourceLabel: string): PolicyResult {
  const block = (reason: string): PolicyResult => ({ status: "BLOCKED", label: "Cross-chain payment", reason });
  if (!workspace.obligations.some((item) => item.id === obligation.id && item.revision === obligation.revision && item.amount.minorUnits === obligation.amount.minorUnits && item.status === obligation.status && item.dueAt === obligation.dueAt)) return block("The obligation does not match the current workspace.");
  if (!["UPCOMING", "OVERDUE"].includes(obligation.status) || BigInt(obligation.amount.minorUnits) <= 0n) return block("Only positive, active obligations can be paid in full.");
  if (workspace.paymentReservations?.some((item) => item.obligationId === obligation.id)) return block("This obligation already has a pending payment.");
  if (availableMinor < requiredMinor) return block(`Your Gateway balance on ${sourceLabel} cannot cover the amount plus Gateway and forwarding fees.`);
  return { status: "PASS", label: "Cross-chain payment", reason: `Paid from your Circle Gateway balance on ${sourceLabel}. Your Arc wallet, safety buffer and other obligations are not used.` };
}

const assertGatewayRail = (proposal: PaymentProposal) => { if (proposal.rail !== "GATEWAY" || !proposal.gateway) throw new EarnAccessError("NOT_A_GATEWAY_PAYMENT", "This payment is paid from the Arc wallet; use the normal payment controls.", 409); };
const pendingOf = (value: unknown) => { const parsed = gatewayPendingSchema.safeParse(value); return parsed.success ? parsed.data : null; };

export async function inspectGatewayPayment(context: PaymentContext, id: string, recovery = false) {
  const { row, record } = await readPayment(context, id, recovery);
  assertGatewayRail(record.proposal);
  const pending = pendingOf(row.pending);
  const sign = record.state === "AWAITING_SIGNATURE" && pending && !pending.signature && row.binding === context.binding ? { id: pending.id, typedData: burnIntentTypedDataJson(pending.intent), intent: pending.intent, expiresAt: pending.expiresAt } : null;
  return { status: "READY" as const, record, pending: null, gateway: { sign, transferId: (row.provider_transaction_id as string | null) ?? null, signed: Boolean(pending?.signature) } };
}

export async function reviewGatewayPayment(context: PaymentContext, mode: ExecutionMode, obligationId: string, sourceKey: string) {
  assertGatewaySigner(context);
  const source = gatewayChainByKey(sourceKey);
  if (!source) throw new EarnAccessError("GATEWAY_CHAIN_UNSUPPORTED", "Choose a supported Gateway testnet.", 400);
  const { data: row, error } = await context.client.from("payment_obligations").select("*").eq("user_id", context.userId).eq("scope", context.scope).eq("id", obligationId).single();
  if (error || !row) throw new EarnAccessError("OBLIGATION_NOT_FOUND", "Sync the obligation before reviewing a payment.", 409);
  const obligation = obligationSchema.parse(row.body);
  let recipient: `0x${string}`;
  try { recipient = paymentRecipient(obligation.recipientAddress, context.wallet.address); }
  catch (cause) { throw new EarnAccessError("INVALID_RECIPIENT", cause instanceof Error ? cause.message : "Invalid recipient.", 409); }
  if (context.scope === "SMOKE_TEST" && BigInt(obligation.amount.minorUnits) > 1_000_000n) throw new EarnAccessError("SMOKE_AMOUNT_LIMIT", "Smoke payments are limited to 1 USDC.", 409);
  assertLiveAmount(mode, obligation.amount.minorUnits);
  await assertLiveReady(context, mode, "QUOTE");
  const value = BigInt(obligation.amount.minorUnits);
  let estimate;
  try { estimate = await estimateForwardedTransfer(buildArcTransferSpec({ source, depositor: context.wallet.address, recipient, valueMinor: value })); }
  catch (cause) { throw new EarnAccessError(cause instanceof GatewayApiError ? cause.code : "GATEWAY_UNAVAILABLE", cause instanceof Error ? cause.message : "Circle Gateway is unavailable.", 503); }
  const [available, block] = await Promise.all([gatewayBalances(context.wallet.address).then((map) => map.get(source.domain) ?? 0n), arcClient.getBlockNumber()]);
  const required = value + estimate.feeMinor;
  const policy = assessGatewayPayment(context.workspace, obligation, available, required, source.label);
  const executionEnabled = isExecutionAvailable(mode);
  const proposal = paymentProposalSchema.parse({
    id: randomUUID(), obligationId, obligationRevision: row.revision, scope: context.scope, wallet: context.wallet, recipientAddress: recipient, recipientLabel: obligation.recipient,
    amount: obligation.amount, feeReserve: usdc(0n), balanceAfter: usdc(available > required ? available - required : 0n), gasBudgetWei: "0", feeQuote: null, policy,
    expiresAt: new Date(Date.now() + SIGN_TTL_MS).toISOString(), startBlock: block.toString(), executionEnabled,
    executionReason: executionEnabled ? `Confirm, then sign once in your wallet (free, no gas). Circle mints the exact amount to the recipient on Arc. Up to ${Number(estimate.feeMinor) / 1e6} USDC in Gateway fees comes out of your ${source.label} Gateway balance.` : "Payment execution is not available on this host.",
    rail: "GATEWAY", gateway: { sourceKey, sourceDomain: source.domain, intent: estimate.intent, feeMinor: estimate.feeMinor.toString(), forwardingFeeMinor: estimate.forwardingFeeMinor.toString(), availableMinor: available.toString() },
  });
  const { error: insertError } = await admin().from("payment_proposals").insert({ id: proposal.id, user_id: context.userId, scope: context.scope, obligation_id: obligationId, wallet_address: context.wallet.address.toLowerCase(), binding: context.binding, policy_digest: context.policyDigest, policy_snapshot: context.workspace.policy, obligation_snapshot: context.workspace.obligations, pending_snapshot: context.workspace.pendingTransactions, proposal, expires_at: proposal.expiresAt });
  if (insertError) throw new EarnAccessError("PAYMENT_STORE_UNAVAILABLE", "The payment proposal could not be saved. Nothing was submitted.", 503);
  return { status: "READY" as const, record: { id: proposal.id, state: "REVIEW_REQUIRED" as const, proposal, txHash: null, userOperationHash: null, receipt: null }, pending: null, gateway: { sign: null, transferId: null, signed: false } };
}

/** Claims the proposal and its wallet lease, then exposes exactly one intent to sign. */
export async function confirmGatewayPayment(context: PaymentContext, mode: ExecutionMode, id: string) {
  assertGatewaySigner(context);
  await assertLiveReady(context, mode, "START");
  const { row, record } = await readPayment(context, id);
  assertGatewayRail(record.proposal);
  const gateway = record.proposal.gateway!;
  if (!record.proposal.executionEnabled) throw new EarnAccessError("EXECUTION_NOT_ENABLED", record.proposal.executionReason, 409);
  if (row.policy_digest !== context.policyDigest || record.state !== "REVIEW_REQUIRED" || Date.parse(record.proposal.expiresAt) <= Date.now()) throw new EarnAccessError("PROPOSAL_NOT_AVAILABLE", "Request a fresh payment proposal.", 409);
  const available = await gatewayBalances(context.wallet.address).then((map) => map.get(gateway.sourceDomain) ?? 0n).catch(() => null);
  if (available === null || available < BigInt(record.proposal.amount.minorUnits) + BigInt(gateway.intent.maxFee)) throw new EarnAccessError("GATEWAY_BALANCE_INSUFFICIENT", "Your Gateway balance changed and no longer covers this payment. Review again; nothing was sent.", 409);
  const { error } = await admin().rpc("hodd_claim_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding });
  if (error) {
    if (/wallet busy/i.test(error.message)) throw new EarnAccessError("WALLET_BUSY", "Another Earn or payment on this wallet needs completion or review first.", 409);
    await admin().rpc("hodd_cancel_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding, p_state: "FAILED" });
    throw new EarnAccessError("PROPOSAL_NOT_AVAILABLE", "The claim could not be verified. Recheck its existing state before requesting another proposal.", 409);
  }
  const pending: GatewayPending = { id: randomUUID(), kind: "GATEWAY_INTENT", intent: gateway.intent, expiresAt: new Date(Date.now() + SIGN_TTL_MS).toISOString() };
  const { data, error: pendingError } = await admin().from("payment_proposals").update({ pending, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).eq("state", "AWAITING_SIGNATURE").is("pending", null).select("id");
  if (pendingError || !data?.length) {
    await admin().rpc("hodd_cancel_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding, p_state: "FAILED" });
    throw new EarnAccessError("PAYMENT_PREPARATION_FAILED", "The payment could not be prepared for signing. Nothing was submitted; request a fresh proposal.", 409);
  }
  return inspectGatewayPayment(context, id);
}

/** Verifies the EIP-712 signature, records it once, then hands it to Gateway. */
export async function signGatewayPayment(context: PaymentContext, id: string, requestId: string, signature: `0x${string}` | null) {
  const { row, record } = await readPayment(context, id);
  assertGatewayRail(record.proposal);
  const pending = pendingOf(row.pending);
  if (!pending || pending.id !== requestId || pending.signature || record.state !== "AWAITING_SIGNATURE" || row.binding !== context.binding) throw new EarnAccessError("REQUEST_ALREADY_ANSWERED", "The signature request is unavailable or already answered.", 409);
  const release = () => admin().rpc("hodd_cancel_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding, p_state: "FAILED" });
  // An EIP-712 signature never reached Gateway until we send it: a refusal is provably unsent.
  if (!signature) { await release(); return inspectGatewayPayment(context, id); }
  if (Date.parse(pending.expiresAt) <= Date.now()) { await release(); throw new EarnAccessError("SIGNING_WINDOW_EXPIRED", "The signing window expired. Nothing was sent; review a fresh payment.", 409); }
  await verifyIntentSignature(pending.intent, signature, context.wallet.address);
  const { data: stored } = await admin().from("payment_proposals").update({ pending: { ...pending, signature }, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).eq("state", "AWAITING_SIGNATURE").eq("pending->>id", pending.id).is("pending->>signature", null).select("id");
  if (!stored?.length) throw new EarnAccessError("REQUEST_ALREADY_ANSWERED", "This signature was already recorded.", 409);
  await submitStored(context, id, pending.intent, signature, true);
  return advanceGatewayPayment(context, id);
}

async function submitStored(context: PaymentContext, id: string, intent: GatewayPending["intent"], signature: `0x${string}`, firstAttempt: boolean) {
  try {
    const transferId = await submitForwardedTransfer(intent, signature);
    await admin().from("payment_proposals").update({ state: "SUBMITTED", provider_transaction_id: transferId, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).in("state", ["AWAITING_SIGNATURE", "UNKNOWN"]).is("provider_transaction_id", null);
  } catch (cause) {
    if (firstAttempt && cause instanceof GatewayApiError && cause.definitive) {
      await admin().rpc("hodd_cancel_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_binding: context.binding, p_state: "FAILED" });
      throw new EarnAccessError(cause.code, `${cause.message} Nothing was sent.`, 409);
    }
    await admin().from("payment_proposals").update({ state: "UNKNOWN", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).eq("state", "AWAITING_SIGNATURE");
  }
}

/** Status/recheck: never signs anything new. Only a verified Arc mint marks the obligation PAID. */
export async function advanceGatewayPayment(context: PaymentContext, id: string, recovery = false) {
  const { row, record } = await readPayment(context, id, recovery);
  assertGatewayRail(record.proposal);
  if (!["AWAITING_SIGNATURE", "SUBMITTED", "UNKNOWN"].includes(record.state)) return inspectGatewayPayment(context, id, recovery);
  const pending = pendingOf(row.pending);
  const expected = { recipient: record.proposal.recipientAddress, valueMinor: BigInt(record.proposal.amount.minorUnits), afterBlock: BigInt(record.proposal.startBlock) };
  let hash = (row.tx_hash as string | null) ?? null;
  const transferId = row.provider_transaction_id as string | null;
  if (!hash && transferId) hash = await gatewayTransferStatus(transferId).then((status) => status.transactionHash ?? null, () => null);
  if (!hash && !transferId && pending?.signature && record.state === "UNKNOWN") {
    // The submission answer was lost. Re-sending the identical signed intent cannot mint twice
    // (Gateway rejects a used spec hash), so it is a lookup, not a second payment.
    const found = await findGatewayMint(expected).catch(() => null);
    if (found) hash = found.hash;
    else await submitStored(context, id, pending.intent, pending.signature as `0x${string}`, false).catch(() => undefined);
  }
  if (hash) await settle(context, id, hash as `0x${string}`, expected).catch(() => undefined);
  return inspectGatewayPayment(context, id, recovery);
}

async function settle(context: PaymentContext, id: string, hash: `0x${string}`, expected: { recipient: string; valueMinor: bigint; afterBlock: bigint }) {
  await admin().from("payment_proposals").update({ tx_hash: hash, updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).in("state", ["AWAITING_SIGNATURE", "SUBMITTED", "UNKNOWN"]).is("tx_hash", null);
  const evidence = await verifyGatewayMint(hash, expected);
  const { error } = await admin().rpc("hodd_finish_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_hash: hash, p_receipt: evidence });
  if (error) throw new Error("PAYMENT_LEDGER_CONFIRMATION_UNAVAILABLE");
}

/**
 * Releases a held Gateway payment only with proof that nothing can be minted:
 * either the intent was never signed and its window expired, or Gateway reports
 * the transfer failed/expired and Arc has no matching mint.
 */
export async function recoverGatewayPayment(context: PaymentContext, id: string) {
  const { row, record } = await readPayment(context, id, true);
  assertGatewayRail(record.proposal);
  const pending = pendingOf(row.pending);
  if (!["AWAITING_SIGNATURE", "SUBMITTED", "UNKNOWN"].includes(record.state) || row.tx_hash) throw new EarnAccessError("RECOVERY_NOT_AVAILABLE", "Only an unminted Gateway payment can be released.", 409);
  let proof: Record<string, string> | null = null;
  if (record.state === "AWAITING_SIGNATURE" && pending && !pending.signature && Date.parse(pending.expiresAt) <= Date.now()) proof = { kind: "GATEWAY_NEVER_SIGNED", requestId: pending.id };
  const transferId = row.provider_transaction_id as string | null;
  if (!proof && transferId) {
    const status = await gatewayTransferStatus(transferId).catch(() => null);
    if (status && (status.status === "failed" || status.status === "expired") && !status.transactionHash) {
      const mint = await findGatewayMint({ recipient: getAddress(record.proposal.recipientAddress), valueMinor: BigInt(record.proposal.amount.minorUnits), afterBlock: BigInt(record.proposal.startBlock) }).catch(() => "UNREADABLE" as const);
      if (mint === null) proof = { kind: "GATEWAY_STATUS", status: status.status, transferId };
    }
  }
  if (!proof) throw new EarnAccessError("RECOVERY_NOT_PROVEN", "Hodd cannot prove that this payment will not be minted. It stays held; check its status again later.", 409);
  if (record.state === "SUBMITTED") await admin().from("payment_proposals").update({ state: "UNKNOWN", updated_at: new Date().toISOString() }).eq("id", id).eq("user_id", context.userId).eq("state", "SUBMITTED").is("tx_hash", null);
  const { error } = await admin().rpc("hodd_release_unsubmitted_payment", { p_user: context.userId, p_scope: context.scope, p_id: id, p_proof: { ...proof, releasedAt: new Date().toISOString() } });
  if (error) throw new EarnAccessError("RECOVERY_NOT_AVAILABLE", "The payment could not be released. It stays held for review.", 409);
  return inspectGatewayPayment(context, id, true);
}

/** Dev test signer: true only when this exact intent is the session's open, unsigned Gateway payment request. */
export async function isPendingGatewayIntent(context: PaymentContext, intent: unknown) {
  const { data } = await admin().from("payment_proposals").select("pending").eq("binding", context.binding).eq("user_id", context.userId).eq("state", "AWAITING_SIGNATURE");
  return (data ?? []).some((row) => { const pending = pendingOf(row.pending); return Boolean(pending && !pending.signature && Date.parse(pending.expiresAt) > Date.now() && JSON.stringify(pending.intent) === JSON.stringify(intent)); });
}
