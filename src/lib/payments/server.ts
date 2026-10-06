import "server-only";
import { randomUUID } from "node:crypto";
import { encodeFunctionData, erc20Abi, getAddress } from "viem";
import { earnServerContext, assertEarnContextCurrent } from "@/lib/earn/server-context";
import { arcClient, discoverAllowedVaults, getEarnPosition } from "@/lib/earn/gateway";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
import { addUsdc } from "@/lib/earn/money";
import { hasVerifiedEarnProvider } from "@/lib/earn/provider-evidence";
import { quotePaymentFees } from "./fees";
import { ViemArcTreasuryReader } from "@/lib/arc/reader";
import { EarnAccessError } from "@/lib/earn/security";
import { obligationSchema } from "@/lib/treasury/models";
import type { WorkspaceScope } from "@/lib/treasury/smoke-workspace";
import { paymentAdmin } from "./admin";
import { assessPayment, paymentRecipient } from "./policy";
import { paymentProposalSchema, paymentRecordSchema, type PaymentProposal } from "./models";
export type PaymentContext = Awaited<ReturnType<typeof earnServerContext>>;
export async function freshPaymentWorkspace(context: PaymentContext) {
  await assertEarnContextCurrent(context);
  const vaults = await discoverAllowedVaults();
  const [snapshot, positions] = await Promise.all([new ViemArcTreasuryReader("https://rpc.testnet.arc.io").readSnapshot(context.wallet.address), Promise.all(vaults.map((vault) => getEarnPosition(context.wallet.address, vault)))]);
  const now = Date.now();
  if ([snapshot, ...positions].some((item) => now - Date.parse(item.observedAt) > 60_000 || Date.parse(item.observedAt) > now + 5_000) || positions.some((item) => item.liquidityStatus !== "READY")) throw new EarnAccessError("STALE_PAYMENT_INPUTS", "Fresh wallet and vault positions are required before payment review.", 409);
  const balance = addUsdc(positions.map((item) => item.currentBalance)); const redeemable = addUsdc(positions.map((item) => item.redeemable));
  return { ...context.workspace, liquidUsdc: snapshot.balance, totalTreasury: addUsdc([snapshot.balance, balance]), strategies: [{ id: "live-morpho", name: "Morpho", kind: "MORPHO" as const, balance, redeemable, risk: "MODERATE" as const, liquidity: "VARIABLE" as const, integration: "LIVE" as const, apyBps: null }] };
}
export const transferCall = (proposal: Pick<PaymentProposal, "recipientAddress" | "amount">) => ({ to: ARC_TESTNET_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(proposal.recipientAddress), BigInt(proposal.amount.minorUnits)] }), value: "0" });
export async function readPayment(context: PaymentContext, id: string, recovery = false) {
  const { data, error } = await context.client.from("payment_proposals").select("*").eq("user_id", context.userId).eq("scope", context.scope).eq("id", id).single();
  if (error || !data) throw new EarnAccessError("PAYMENT_NOT_FOUND", "Payment unavailable in this wallet session.", 404);
  const record = paymentRecordSchema.parse({ id: data.id, state: data.state, proposal: data.proposal, txHash: data.tx_hash, userOperationHash: data.user_operation_hash, receipt: data.receipt });
  if ((!recovery && data.binding !== context.binding) || record.proposal.wallet.address.toLowerCase() !== context.wallet.address.toLowerCase() || record.proposal.wallet.provider !== context.wallet.provider || record.proposal.wallet.chainId !== context.wallet.chainId) throw new EarnAccessError("PAYMENT_NOT_FOUND", "Reconnect the original wallet for payment recovery.", 404);
  return { row: data, record };
}
export async function createPaymentProposal(scope: WorkspaceScope, obligationId: string) {
  const context = await earnServerContext(scope); const admin = paymentAdmin();
  const { data: row, error } = await context.client.from("payment_obligations").select("*").eq("user_id", context.userId).eq("scope", scope).eq("id", obligationId).single();
  if (error || !row) throw new EarnAccessError("OBLIGATION_NOT_FOUND", "Sync the obligation before reviewing a payment.", 409);
  const obligation = obligationSchema.parse(row.body); const recipient = paymentRecipient(obligation.recipientAddress, context.wallet.address);
  if (scope === "SMOKE_TEST" && BigInt(obligation.amount.minorUnits) > 1_000_000n) throw new EarnAccessError("SMOKE_AMOUNT_LIMIT", "Smoke payments are limited to 1 USDC.", 409);
  const workspace = await freshPaymentWorkspace(context);
  const call = transferCall({ recipientAddress: recipient, amount: addUsdc([obligation.amount]) });
  const [feeQuote, block, verified] = await Promise.all([quotePaymentFees(context, call), arcClient.getBlockNumber(), hasVerifiedEarnProvider(context)]);
  const budget = feeQuote?.maxNativeFeeWei ?? "0";
  const feeReserve = feeQuote?.maxWalletDebit ?? addUsdc([]);
  let policy = assessPayment(workspace, obligation, feeReserve);
  if (!feeQuote) policy = { status: "BLOCKED", label: "Provider fee quote", reason: "Server-verified deployment, verification and paymaster fee ceilings are not available. No zero-fee assumption is used." };
  const executionEnabled = verified && Boolean(feeQuote) && process.env.HODD_PAYMENT_EXECUTION_ENABLED === "true";
  const executionReason = !feeQuote ? "A provider-specific smart-account fee ceiling must be verified before payment execution." : !verified ? "Verified Stage 4 deposit, partial withdrawal and full redemption receipts are still required for this wallet/provider." : "Local execution is available only with the payment feature flag and your separate approval.";
  if (Date.now() - Date.parse(workspace.updatedAt) < -5000) policy = { status: "BLOCKED", label: "Workspace", reason: "Workspace timestamp is invalid." };
  const remaining = BigInt(workspace.liquidUsdc.minorUnits) - BigInt(obligation.amount.minorUnits) - BigInt(feeReserve.minorUnits);
  const proposal = paymentProposalSchema.parse({ id: randomUUID(), obligationId, obligationRevision: row.revision, scope, wallet: context.wallet, recipientAddress: recipient, recipientLabel: obligation.recipient, amount: obligation.amount, feeReserve, feeQuote, gasBudgetWei: budget, balanceAfter: { ...workspace.liquidUsdc, minorUnits: (remaining > 0n ? remaining : 0n).toString() }, policy, expiresAt: feeQuote?.expiresAt ?? new Date(Date.now()+300000).toISOString(), startBlock: block.toString(), executionEnabled, executionReason });
  const { error: insertError } = await admin.from("payment_proposals").insert({ id: proposal.id, user_id: context.userId, scope, obligation_id: obligationId, wallet_address: context.wallet.address.toLowerCase(), binding: context.binding, policy_digest: context.policyDigest, policy_snapshot: context.workspace.policy, obligation_snapshot: context.workspace.obligations, pending_snapshot: context.workspace.pendingTransactions, proposal, expires_at: proposal.expiresAt });
  if (insertError) throw new EarnAccessError("PAYMENT_STORE_UNAVAILABLE", "The payment proposal could not be saved. Nothing was submitted.", 503);
  return { status: "READY" as const, record: { id: proposal.id, state: "REVIEW_REQUIRED" as const, proposal, txHash: null, userOperationHash: null, receipt: null }, pending: null };
}
