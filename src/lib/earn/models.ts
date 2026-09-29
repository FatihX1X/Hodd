import { z } from "zod";
import { moneySchema, policyResultSchema } from "@/lib/treasury/models";

export const arcAddressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
export const earnOperationSchema = z.enum(["DEPOSIT", "WITHDRAW", "REDEEM_ALL"]);
export const usdcMoneySchema = moneySchema.extend({ currency: z.literal("USDC"), decimals: z.literal(6) });

export const earnVaultSchema = z.object({
  address: arcAddressSchema,
  name: z.string(),
  chain: z.literal("ARC-TESTNET"),
  protocol: z.literal("MORPHO"),
  asset: z.literal("USDC"),
  assetAddress: arcAddressSchema,
  apyBps: z.number().int().nonnegative(),
  totalDeposits: usdcMoneySchema,
  liquidity: usdcMoneySchema,
  status: z.enum(["ACTIVE", "LOW_LIQUIDITY"]),
  circleGuarded: z.boolean(),
  warnings: z.array(z.object({ type: z.string(), level: z.enum(["YELLOW", "RED"]) })),
  earnKitWarnings: z.array(z.string()),
  verifiedAt: z.string().datetime(),
  verifiedBlock: z.string().regex(/^\d+$/),
});

const pnlSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("AVAILABLE"), principalDeposited: usdcMoneySchema, totalYieldEarned: z.object({ currency: z.literal("USDC"), minorUnits: z.string().regex(/^-?\d+$/), decimals: z.literal(6) }) }),
  z.object({ status: z.literal("PENDING") }),
  z.object({ status: z.literal("UNAVAILABLE"), reason: z.string() }),
]);

export const earnPositionSchema = z.object({
  walletAddress: arcAddressSchema,
  vaultAddress: arcAddressSchema,
  vaultName: z.string(),
  currentBalance: usdcMoneySchema,
  maxWithdrawable: usdcMoneySchema,
  redeemable: usdcMoneySchema,
  liquidityStatus: z.enum(["READY", "UNAVAILABLE"]),
  shares: z.string().regex(/^\d+(?:\.\d+)?$/),
  apyBps: z.number().int().nonnegative(),
  pnl: pnlSchema,
  observedAt: z.string().datetime(),
});

export const earnGasFeeSchema = z.object({ name: z.string(), amount: usdcMoneySchema.nullable(), error: z.string().optional() });
export const earnQuoteSchema = z.object({
  quoteId: z.string().uuid().nullable(),
  operation: earnOperationSchema,
  walletAddress: arcAddressSchema,
  vaultAddress: arcAddressSchema,
  vaultName: z.string(),
  amount: usdcMoneySchema,
  expectedShares: z.string().nullable(),
  sharesToRedeem: z.string().nullable(),
  maxWithdrawable: usdcMoneySchema.nullable(),
  fees: usdcMoneySchema,
  gasFees: z.array(earnGasFeeSchema),
  warnings: z.array(z.string()),
  policy: policyResultSchema,
  expiresAt: z.string().datetime().nullable(),
  requiresWarningAcknowledgement: z.boolean(),
});

export const earnExecutionResultSchema = z.object({
  executionId: z.string().uuid(),
  operation: earnOperationSchema,
  status: z.enum(["COMPLETE", "PARTIAL", "UNKNOWN"]),
  txHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  explorerUrl: z.string().url(),
  vaultAddress: arcAddressSchema,
  amount: usdcMoneySchema,
  residualPosition: earnPositionSchema.nullable(),
});

export const earnIntegrationStatusSchema = z.object({
  discovery: z.enum(["READY", "UNAVAILABLE"]),
  positionAccess: z.enum(["READY", "NOT_CONFIGURED", "ADDRESS_MISMATCH", "UNAVAILABLE"]),
  execution: z.enum(["LOCAL_ENABLED", "READ_ONLY", "PRODUCTION_DISABLED"]),
  configuredWalletAddress: arcAddressSchema.nullable(),
  message: z.string(),
});

export const earnPortfolioResponseSchema = z.object({
  status: z.literal("READY"),
  integration: earnIntegrationStatusSchema,
  vaults: z.array(earnVaultSchema),
  positions: z.array(earnPositionSchema),
  observedAt: z.string().datetime(),
});
export const earnErrorResponseSchema = z.object({ status: z.literal("ERROR"), code: z.string(), message: z.string() });
export const earnPortfolioApiSchema = z.union([earnPortfolioResponseSchema, earnErrorResponseSchema]);

export const earnQuoteRequestSchema = z.object({
  operation: earnOperationSchema,
  walletAddress: arcAddressSchema,
  vaultAddress: arcAddressSchema,
  amount: z.string().trim().regex(/^\d+(?:\.\d{1,6})?$/).optional(),
  policyLimit: usdcMoneySchema,
});
export const earnQuoteApiSchema = z.union([z.object({ status: z.literal("READY"), quote: earnQuoteSchema }), earnErrorResponseSchema]);
export const earnExecuteRequestSchema = z.object({ quoteId: z.string().uuid(), confirmed: z.literal(true), warningsAcknowledged: z.boolean() });
export const earnExecuteApiSchema = z.union([z.object({ status: z.literal("READY"), result: earnExecutionResultSchema }), earnErrorResponseSchema]);

export type EarnVault = z.infer<typeof earnVaultSchema>;
export type EarnPosition = z.infer<typeof earnPositionSchema>;
export type EarnQuote = z.infer<typeof earnQuoteSchema>;
export type EarnOperation = z.infer<typeof earnOperationSchema>;
export type EarnExecutionResult = z.infer<typeof earnExecutionResultSchema>;
export type EarnIntegrationStatus = z.infer<typeof earnIntegrationStatusSchema>;
export type EarnPortfolioResponse = z.infer<typeof earnPortfolioResponseSchema>;
export type EarnOperationIntent = z.infer<typeof earnQuoteRequestSchema>;
