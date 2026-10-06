import { z } from "zod";
import { arcAddressSchema, usdcMoneySchema } from "@/lib/earn/models";
import { nativeWeiToUsdcCeil } from "@/lib/earn/money";

const integer = z.string().regex(/^\d+$/);
const hex = z.string().regex(/^0x[\da-fA-F]*$/);
// Circle's official Gas Station reference, verified 2026-10-06. Not the
// USDC-charging Circle Paymaster: no unsponsored/paid-paymaster fallback.
export const ARC_GAS_STATION_PAYMASTER = "0x7ceA357B5AC0639F89F9e378a1f03Aa5005C0a25";
export const sponsoredUserOperationSchema = z.object({
  sender: arcAddressSchema, nonce: integer, callData: hex,
  factory: arcAddressSchema.optional(), factoryData: hex.optional(),
  callGasLimit: integer, verificationGasLimit: integer, preVerificationGas: integer,
  maxFeePerGas: integer, maxPriorityFeePerGas: integer,
  paymaster: arcAddressSchema, paymasterData: hex,
  paymasterVerificationGasLimit: integer, paymasterPostOpGasLimit: integer,
}).strict();
export const walletFeeQuoteSchema = z.object({
  provider: z.enum(["INJECTED_METAMASK", "INJECTED_RABBY", "CIRCLE_USER_CONTROLLED", "CIRCLE_MODULAR"]),
  walletAddress: arcAddressSchema, chainId: z.literal(5042002), operationDigest: z.string(),
  observedAt: z.string().datetime(), expiresAt: z.string().datetime(),
  sponsorship: z.enum(["NOT_ASSUMED", "VERIFIED"]),
  gasLimit: integer, maxFeePerGasWei: integer, priorityFeePerGasWei: integer,
  maxNativeFeeWei: integer, maxWalletDebit: usdcMoneySchema,
  source: z.enum(["ARC_EOA", "CIRCLE_UCW", "CIRCLE_MSCA"]),
  userOperation: sponsoredUserOperationSchema.optional(),
}).superRefine((quote, context) => {
  const cap = BigInt(quote.gasLimit) * BigInt(quote.maxFeePerGasWei);
  if (cap <= 0n || cap !== BigInt(quote.maxNativeFeeWei) || BigInt(quote.priorityFeePerGasWei) > BigInt(quote.maxFeePerGasWei)) context.addIssue({ code: "custom", message: "Invalid fee ceiling" });
  if (quote.source !== "CIRCLE_MSCA" && (quote.sponsorship !== "NOT_ASSUMED" || quote.userOperation || quote.maxWalletDebit.minorUnits !== nativeWeiToUsdcCeil(cap.toString()).minorUnits)) context.addIssue({ code: "custom", message: "Unsupported sponsorship or wallet debit" });
  if (Date.parse(quote.expiresAt) <= Date.parse(quote.observedAt) || Date.parse(quote.expiresAt) - Date.parse(quote.observedAt) > 300_000) context.addIssue({ code: "custom", message: "Invalid fee validity" });
  if ((quote.source === "ARC_EOA") !== quote.provider.startsWith("INJECTED_")) context.addIssue({ code: "custom", message: "Fee source/provider mismatch" });
  if (quote.source === "CIRCLE_UCW" && quote.provider !== "CIRCLE_USER_CONTROLLED") context.addIssue({ code: "custom", message: "Unsupported smart-account fee source" });
  if (quote.source === "CIRCLE_MSCA") {
    const op = quote.userOperation;
    if (quote.provider !== "CIRCLE_MODULAR" || quote.sponsorship !== "VERIFIED" || quote.maxWalletDebit.minorUnits !== "0" || !op || op.sender.toLowerCase() !== quote.walletAddress.toLowerCase() || op.paymaster.toLowerCase() !== ARC_GAS_STATION_PAYMASTER.toLowerCase() || op.maxFeePerGas !== quote.maxFeePerGasWei || op.maxPriorityFeePerGas !== quote.priorityFeePerGasWei || (Boolean(op.factory) !== Boolean(op.factoryData)) || [op.callGasLimit, op.verificationGasLimit, op.preVerificationGas, op.paymasterVerificationGasLimit, op.paymasterPostOpGasLimit].reduce((sum, value) => sum + BigInt(value), 0n) !== BigInt(quote.gasLimit)) context.addIssue({ code: "custom", message: "Unverified sponsored UserOperation" });
  }
});
export type WalletFeeQuote = z.infer<typeof walletFeeQuoteSchema>;

/** SDK fee strings are decimal gwei, not JS numbers. Round upward to a wei. */
export function decimalToIntegerCeil(value: string, decimals: number): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || decimals < 0 || decimals > 18) throw new Error("INVALID_PROVIDER_FEE");
  const fraction = match[2] ?? "";
  const retained = fraction.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(match[1] + retained) + (/[1-9]/.test(fraction.slice(decimals)) ? 1n : 0n);
}

export function assertFeeBinding(quote: WalletFeeQuote | undefined, binding: { provider: string; address: string; digest: string }, now = Date.now()) {
  const parsed = walletFeeQuoteSchema.safeParse(quote);
  if (!parsed.success || parsed.data.provider !== binding.provider || parsed.data.walletAddress.toLowerCase() !== binding.address.toLowerCase() || parsed.data.operationDigest !== binding.digest || Date.parse(parsed.data.expiresAt) <= now || Date.parse(parsed.data.observedAt) > now + 5_000) throw new Error("FEE_QUOTE_NOT_AVAILABLE");
  return parsed.data;
}
