import { z } from "zod";

// The /api/usyc contract, shared by the server routes, the treasury engine and the console. Amounts are
// integer strings in token base units: USDC and USYC both have 6 decimals; prices have 18.
const units = z.string().regex(/^\d{1,40}$/);
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const usycPositionSchema = z.object({
  wallet: address,
  /** PAUSED: Circle's entitlements are paused and every allowlist check reverts. Treat USYC as temporarily unavailable. */
  authority: z.enum(["OK", "PAUSED"]),
  allowlisted: z.object({
    /** Allowed to call `deposit` and to receive USYC. */
    subscribe: z.boolean(),
    /** Allowed to call `redeem` and to hold or move USYC. */
    redeem: z.boolean(),
    /** Allowed to receive USYC (`transfer` entitlement). */
    receive: z.boolean(),
  }),
  balanceShares: units,
  /** `balance × latest price` via the Teller's convertToAssets, in USDC. */
  valueUsdc: units,
  /** Latest oracle price (used for redemptions and valuation), 18 decimals. */
  priceUsdcPerUsyc: units,
  /** Price a subscription gets right now; differs from the latest price when the next price applies. */
  subscribePriceUsdcPerUsyc: units,
  /** Subscriptions after the 14:00 New York cutoff, or with a stale oracle price, use the next price. */
  afterHoursPricing: z.boolean(),
  /** Fee rates as decimal percentages ("0.04" = 0.04%). A quote shows the actual fee for its amount. */
  fees: z.object({ subscribePercent: z.string(), redeemPercent: z.string() }),
  /** What today's (UTC) per-wallet limits still allow, in USDC. */
  limitsRemaining: z.object({ subscribe: units, redeem: units }),
  /** Most USYC the Teller would redeem for this wallet right now (balance, daily limit and fund liquidity), and its USDC value. */
  maxRedeemShares: units,
  maxRedeemValueUsdc: units,
  observedAt: z.string().datetime(),
});
export type UsycPosition = z.infer<typeof usycPositionSchema>;

export const usycStatusResponseSchema = z.object({
  status: z.literal("READY"),
  position: usycPositionSchema,
  /** Whether quotes can be requested now (kill switch on, host allowed). Reads always work. */
  executionEnabled: z.boolean(),
  /** Why quotes are closed, in plain English; null while open. */
  executionNote: z.string().nullable(),
  /** False for wallets that cannot sign USYC transactions in Hodd (Circle PIN wallets). */
  walletCanSign: z.boolean(),
});
export type UsycStatusResponse = z.infer<typeof usycStatusResponseSchema>;

export const usycStageSchema = z.enum(["APPROVE", "SUBSCRIBE", "REDEEM"]);
export type UsycStage = z.infer<typeof usycStageSchema>;

const callSchema = z.object({ to: address, data: hex, value: z.literal("0") });
const gasCeilingSchema = z.object({ gasLimit: units, gasPriceWei: units });
export const usycStepSchema = z.object({ stage: usycStageSchema, call: callSchema, gasBudgetWei: units, gasCeiling: gasCeilingSchema });
export type UsycStep = z.infer<typeof usycStepSchema>;

export const usycQuoteSchema = z.object({
  kind: z.enum(["SUBSCRIBE", "REDEEM"]),
  wallet: address,
  /** Subscribe: USDC to spend. Redeem: USYC to redeem. */
  amountMinor: units,
  /** In signing order: approve then subscribe, or the single redeem. */
  steps: z.array(usycStepSchema).min(1).max(2),
  preview: z.object({
    /** Subscribe: USYC expected. Redeem: USYC redeemed. */
    sharesMinor: units,
    /** Subscribe: USDC spent including any fee. Redeem: USDC received after any fee. */
    assetsMinor: units,
    feeMinor: units,
    /** Price used by the Teller for this action, 18 decimals. */
    priceUsdcPerUsyc: units,
    afterHoursPricing: z.boolean(),
  }),
  /** Network fee ceiling across all steps, in USDC (Arc's gas token). */
  networkFeeMinor: units,
  /** True when every step's gas was measured by the node (the deposit with a simulated approval); false when the documented fallback was used for the deposit. */
  gasSimulated: z.boolean(),
  observedAt: z.string().datetime(),
});
export type UsycQuote = z.infer<typeof usycQuoteSchema>;

export const usycQuoteResponseSchema = z.object({ status: z.literal("READY"), quote: usycQuoteSchema });

export const usycVerifySchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "REVERTED", "UNRELATED"]),
  step: usycStageSchema,
  txHash: hash,
  /** CONFIRMED subscribe: the exact USYC minted to the wallet and the USDC spent. */
  mintedSharesMinor: units.optional(),
  spentAssetsMinor: units.optional(),
  /** CONFIRMED redeem: the exact USYC burned and the USDC sent to the wallet. */
  burnedSharesMinor: units.optional(),
  receivedAssetsMinor: units.optional(),
});
export type UsycVerification = z.infer<typeof usycVerifySchema>;

export const usycErrorSchema = z.object({ status: z.literal("ERROR"), code: z.string(), message: z.string() });

/** Request bodies for POST /api/usyc. The wallet is always the signed-in session's wallet, never a field. */
export const usycRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("QUOTE_SUBSCRIBE"), amountMinor: z.string().regex(/^[1-9]\d{0,15}$/) }).strict(),
  z.object({ action: z.literal("QUOTE_REDEEM"), sharesMinor: z.string().regex(/^[1-9]\d{0,15}$/).optional(), all: z.literal(true).optional() }).strict()
    .refine((value) => (value.sharesMinor === undefined) !== (value.all === undefined), "Give either sharesMinor or all"),
  z.object({ action: z.literal("VERIFY"), step: usycStageSchema, txHash: hash, amountMinor: z.string().regex(/^[1-9]\d{0,15}$/).optional() }).strict(),
]);
export type UsycRequest = z.infer<typeof usycRequestSchema>;
