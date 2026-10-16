import { z } from "zod";

// The /api/usyc contract, shared by the server routes, the treasury engine and the console. Users deal only in
// USDC through Hodd's pooled vault (HoddUSYCVault); the pool holds the USYC. Amounts are integer strings in base
// units: USDC and USYC have 6 decimals, pool shares 12, prices 18.
const units = z.string().regex(/^\d{1,48}$/);
const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/);
const hex = z.string().regex(/^0x[0-9a-fA-F]*$/);
const hash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

export const usycPositionSchema = z.object({
  wallet: address,
  pool: address,
  /**
   * Circle's side of the pool. OK: Circle allowlists the pool. NOT_PERMITTED: the pool is not (or no longer)
   * allowlisted, so nothing can be bought or redeemed until Circle restores it. PAUSED: Circle paused USYC.
   */
  circle: z.enum(["OK", "NOT_PERMITTED", "PAUSED"]),
  /** Hodd paused new deposits (withdrawals are never paused by Hodd). */
  depositsPaused: z.boolean(),
  /** The most USDC one deposit can bring right now (caps, Circle's daily limit), 0 when deposits are closed. */
  maxDepositUsdc: units,
  /** The user's pool shares (12 decimals), the USYC they stand for and their USDC value if redeemed now. */
  shares: units,
  usycMinor: units,
  valueUsdc: units,
  /** The most the user could withdraw right now (Circle's daily limit and fund liquidity are shared by the pool). */
  maxWithdrawShares: units,
  maxWithdrawUsdc: units,
  /** Latest USYC price (redemptions, valuation) and the price a deposit gets now, 18 decimals. */
  priceUsdcPerUsyc: units,
  subscribePriceUsdcPerUsyc: units,
  /** Deposits after the 14:00 New York cutoff, or on a stale oracle price, buy at the next price. */
  afterHoursPricing: z.boolean(),
  observedAt: z.string().datetime(),
});
export type UsycPosition = z.infer<typeof usycPositionSchema>;

export const usycStatusResponseSchema = z.object({
  status: z.literal("READY"),
  /** null while the pool is not deployed yet. */
  position: usycPositionSchema.nullable(),
  /** Whether quotes can be requested now (kill switch on, host allowed). Reads always work. */
  executionEnabled: z.boolean(),
  /** Why quotes are closed, in plain English; null while open. */
  executionNote: z.string().nullable(),
  /** False for wallets that cannot sign these transactions in Hodd (Circle PIN wallets). */
  walletCanSign: z.boolean(),
});
export type UsycStatusResponse = z.infer<typeof usycStatusResponseSchema>;

export const usycStageSchema = z.enum(["APPROVE", "DEPOSIT", "WITHDRAW"]);
export type UsycStage = z.infer<typeof usycStageSchema>;

const callSchema = z.object({ to: address, data: hex, value: z.literal("0") });
const gasCeilingSchema = z.object({ gasLimit: units, gasPriceWei: units });
export const usycStepSchema = z.object({ stage: usycStageSchema, call: callSchema, gasBudgetWei: units, gasCeiling: gasCeilingSchema });
export type UsycStep = z.infer<typeof usycStepSchema>;

export const usycQuoteSchema = z.object({
  kind: z.enum(["DEPOSIT", "WITHDRAW"]),
  wallet: address,
  /** Deposit: USDC put in. Withdraw: pool shares redeemed. */
  amountMinor: units,
  /** In signing order: approve then deposit, or the single withdrawal. */
  steps: z.array(usycStepSchema).min(1).max(2),
  preview: z.object({
    /** USDC in (deposit) or expected out (withdraw). */
    usdcMinor: units,
    /** Pool shares expected (deposit) or redeemed (withdraw). */
    shares: units,
    /** The bound written into the transaction: minimum shares (deposit) or minimum USDC (withdraw). */
    minimum: units,
    afterHoursPricing: z.boolean(),
  }),
  /** Network fee ceiling across all steps, in USDC (Arc's gas token). */
  networkFeeMinor: units,
  /** False when the deposit's gas could not be simulated and the documented fallback was used. */
  gasSimulated: z.boolean(),
  observedAt: z.string().datetime(),
});
export type UsycQuote = z.infer<typeof usycQuoteSchema>;

export const usycQuoteResponseSchema = z.object({ status: z.literal("READY"), quote: usycQuoteSchema });

export const usycVerifySchema = z.object({
  status: z.enum(["PENDING", "CONFIRMED", "REVERTED", "UNRELATED"]),
  step: usycStageSchema,
  txHash: hash,
  /** CONFIRMED deposit: USDC put in and pool shares received. */
  depositedUsdcMinor: units.optional(),
  receivedShares: units.optional(),
  /** CONFIRMED withdrawal: pool shares burned and USDC received. */
  burnedShares: units.optional(),
  receivedUsdcMinor: units.optional(),
});
export type UsycVerification = z.infer<typeof usycVerifySchema>;

export const usycErrorSchema = z.object({ status: z.literal("ERROR"), code: z.string(), message: z.string() });

const usdcAmount = z.string().regex(/^[1-9]\d{0,15}$/);
/** Request bodies for POST /api/usyc. The wallet is always the signed-in session's wallet, never a field. */
export const usycRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("QUOTE_DEPOSIT"), amountMinor: usdcAmount }).strict(),
  z.object({ action: z.literal("QUOTE_WITHDRAW"), amountMinor: usdcAmount.optional(), all: z.literal(true).optional() }).strict()
    .refine((value) => (value.amountMinor === undefined) !== (value.all === undefined), "Give either amountMinor or all"),
  z.object({ action: z.literal("VERIFY"), step: usycStageSchema, txHash: hash, amountMinor: z.string().regex(/^[1-9]\d{0,40}$/).optional() }).strict(),
]);
export type UsycRequest = z.infer<typeof usycRequestSchema>;
