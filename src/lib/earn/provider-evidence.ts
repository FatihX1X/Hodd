import "server-only";
import { z } from "zod";
import { walletConnectionSchema } from "@/lib/treasury/models";
import { paymentAdmin } from "@/lib/payments/admin";
import { arcClient } from "./gateway";
import { earnQuoteSchema, earnExecutionResultSchema, type EarnQuote, type EarnExecutionResult } from "./models";
import { verifyEarnReceipt } from "./receipts";
import type { PaymentContext } from "@/lib/payments/server";
import { isAllowedVault } from "./allowlist";

const evidenceSchema = z.object({
  id: z.string().uuid(), user_id: z.string().uuid(), wallet: walletConnectionSchema,
  quote: earnQuoteSchema, result: earnExecutionResultSchema,
  started_block: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String), verified_block: z.union([z.string().regex(/^\d+$/), z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)]).transform(String),
  sdk_versions: z.object({ appKit: z.literal("1.15.3"), circleWalletAdapter: z.literal("1.8.0"), modularWallet: z.literal("1.0.16"), userControlledWallet: z.literal("10.8.1") }),
});

/** Called only after the job has verified the receipt and re-read its position. */
export async function recordEarnEvidence(context: PaymentContext, quote: EarnQuote, result: EarnExecutionResult, startedBlock: bigint, verifiedBlock: bigint) {
  if (context.scope !== "SMOKE_TEST" || result.status !== "COMPLETE") return;
  const evidence = evidenceSchema.parse({ id: result.executionId, user_id: context.userId, wallet: context.wallet, quote, result, started_block: startedBlock.toString(), verified_block: verifiedBlock.toString(), sdk_versions: { appKit: "1.15.3", circleWalletAdapter: "1.8.0", modularWallet: "1.0.16", userControlledWallet: "10.8.1" } });
  const { error } = await paymentAdmin().from("earn_provider_evidence").insert({ ...evidence, provider: context.wallet.provider, wallet_address: context.wallet.address.toLowerCase() });
  if (error) throw new Error("PROVIDER_EVIDENCE_STORE_UNAVAILABLE");
}

/** A hand-entered flag/hash cannot enable a provider. Re-verify real receipts. */
export async function hasVerifiedEarnProvider(context: PaymentContext) {
  const { data, error } = await context.client.from("earn_provider_evidence").select("*").eq("user_id", context.userId).eq("provider", context.wallet.provider).eq("wallet_address", context.wallet.address.toLowerCase()).order("verified_block", { ascending: false }).limit(30);
  if (error || !data || await arcClient.getChainId() !== 5042002) return false;
  const verified: z.infer<typeof evidenceSchema>[] = [];
  for (const row of data) {
    const parsed = evidenceSchema.safeParse(row);
    if (!parsed.success) continue;
    const evidence = parsed.data;
    if (evidence.user_id !== context.userId || !isAllowedVault(evidence.quote.vaultAddress)) continue;
    if (evidence.wallet.provider !== context.wallet.provider || evidence.wallet.accountType !== context.wallet.accountType || evidence.wallet.address.toLowerCase() !== context.wallet.address.toLowerCase() || evidence.quote.walletAddress.toLowerCase() !== context.wallet.address.toLowerCase() || evidence.result.status !== "COMPLETE" || evidence.result.operation !== evidence.quote.operation || evidence.quote.quoteId !== evidence.id || evidence.result.executionId !== evidence.id || evidence.result.amount.minorUnits !== evidence.quote.amount.minorUnits || evidence.result.vaultAddress.toLowerCase() !== evidence.quote.vaultAddress.toLowerCase()) continue;
    if (evidence.quote.operation === "DEPOSIT" && (BigInt(evidence.quote.amount.minorUnits) <= 0n || BigInt(evidence.quote.amount.minorUnits) > 1_000_000n)) continue;
    if (evidence.quote.operation === "REDEEM_ALL" && (!evidence.result.residualPosition || /[1-9]/.test(evidence.result.residualPosition.shares))) continue;
    try {
      const receipt = await arcClient.getTransactionReceipt({ hash: evidence.result.txHash as `0x${string}` });
      if (receipt.blockNumber <= BigInt(evidence.started_block) || receipt.blockNumber !== BigInt(evidence.verified_block)) continue;
      verifyEarnReceipt(receipt, evidence.quote);
      verified.push(evidence);
    } catch { /* Missing or unrelated evidence never enables execution. */ }
  }
  return verified.some((deposit) => deposit.quote.operation === "DEPOSIT" && verified.some((withdrawal) => withdrawal.quote.operation === "WITHDRAW" && withdrawal.quote.vaultAddress.toLowerCase() === deposit.quote.vaultAddress.toLowerCase() && BigInt(withdrawal.quote.amount.minorUnits) < BigInt(deposit.quote.amount.minorUnits) && BigInt(withdrawal.verified_block) > BigInt(deposit.verified_block) && verified.some((redeem) => redeem.quote.operation === "REDEEM_ALL" && redeem.quote.vaultAddress.toLowerCase() === deposit.quote.vaultAddress.toLowerCase() && BigInt(redeem.verified_block) > BigInt(withdrawal.verified_block))));
}
