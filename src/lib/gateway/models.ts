import { z } from "zod";
import { burnIntentSchema } from "./intent";

const usdc = z.object({ currency: z.literal("USDC"), decimals: z.literal(6), minorUnits: z.string().regex(/^\d+$/) });
const hash = z.string().regex(/^0x[\da-fA-F]{64}$/);

export const unifiedUsdcViewSchema = z.object({
  address: z.string(), observedAt: z.string().datetime(),
  chains: z.array(z.object({ key: z.string(), label: z.string(), domain: z.number().int(), nativeSymbol: z.string(), depositWait: z.string(), wallet: usdc.nullable(), gateway: usdc.nullable() })),
  totals: z.object({ wallet: usdc, gateway: usdc, all: usdc, offArcWallet: usdc }),
  gatewayStatus: z.enum(["READY", "UNAVAILABLE"]), unavailableChains: z.array(z.string()),
});
export type UnifiedUsdcView = z.infer<typeof unifiedUsdcViewSchema>;

/** Stored on a payment proposal paid from a Gateway balance instead of the Arc wallet. */
export const gatewayPaymentSchema = z.object({
  sourceKey: z.string(), sourceDomain: z.number().int(), intent: burnIntentSchema,
  feeMinor: z.string().regex(/^\d+$/), forwardingFeeMinor: z.string().regex(/^\d+$/), availableMinor: z.string().regex(/^\d+$/),
});
export type GatewayPayment = z.infer<typeof gatewayPaymentSchema>;

/** A Gateway → Arc move into the user's own wallet (no obligation). */
export const gatewayMoveSchema = z.object({
  status: z.literal("READY"), stage: z.enum(["SIGN", "SUBMITTED", "CONFIRMED", "FAILED"]),
  handle: z.string(), sourceKey: z.string(), amount: usdc, fee: usdc, forwardingFee: usdc, recipient: z.string(),
  intent: burnIntentSchema, typedData: z.record(z.string(), z.unknown()).optional(), transferId: z.string().uuid().nullable(),
  mintTxHash: hash.nullable(), message: z.string(),
});
export type GatewayMove = z.infer<typeof gatewayMoveSchema>;
export const gatewayErrorSchema = z.object({ status: z.literal("ERROR"), code: z.string(), message: z.string() });
