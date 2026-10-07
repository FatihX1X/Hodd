import { z } from "zod";

export const moneySchema = z.object({ currency: z.enum(["USDC", "USD"]), minorUnits: z.string().regex(/^\d+$/), decimals: z.number().int().nonnegative() });
export const obligationSchema = z.object({
  id: z.string().min(1), title: z.string().trim().min(1).max(80),
  category: z.enum(["PAYROLL", "VENDOR", "SUBSCRIPTION", "RENT", "TAX", "OTHER"]), amount: moneySchema,
  dueAt: z.string().datetime(), recipient: z.string().trim().max(120).nullable(),
  priority: z.enum(["CRITICAL", "HIGH", "NORMAL", "LOW"]), status: z.enum(["UPCOMING", "DRAFT", "PAID", "OVERDUE"]),
  description: z.string().trim().max(500),
  recipientAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).nullable().optional(),
  revision: z.number().int().positive().optional(),
  paymentReference: z.string().uuid().nullable().optional(),
});
export const strategyKindSchema = z.enum(["LIQUID", "MORPHO", "USYC", "BTC_RESERVE"]);
export const liquiditySourceSchema = z.enum(["LIQUID_USDC", "MORPHO", "USYC", "BTC_CREDIT", "BTC_SALE"]);
export const strategyPositionSchema = z.object({
  id: z.string(), name: z.string(), kind: strategyKindSchema, balance: moneySchema, redeemable: moneySchema,
  apyBps: z.number().int().nullable(), risk: z.enum(["LOW", "MODERATE", "HIGH"]),
  liquidity: z.enum(["INSTANT", "VARIABLE", "RESTRICTED"]), integration: z.enum(["DEMO", "LIVE", "UNAVAILABLE", "FUTURE"]),
});
export const policyResultSchema = z.object({ status: z.enum(["PASS", "REVIEW", "BLOCKED", "NOT_EVALUATED"]), label: z.string(), reason: z.string() });
export const activityEntrySchema = z.object({
  id: z.string(), occurredAt: z.string().datetime(), actor: z.enum(["HUMAN", "AGENT", "SYSTEM"]), action: z.string(), summary: z.string(), reason: z.string(),
  policy: policyResultSchema, approval: z.enum(["NOT_REQUIRED", "PENDING", "APPROVED", "DENIED"]),
  execution: z.enum(["LOCAL_ONLY", "DEMO_ONLY", "NOT_STARTED", "SUBMITTED", "COMPLETE", "PARTIAL", "FAILED", "UNKNOWN"]),
  transactionHash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).optional(),
  explorerUrl: z.string().url().optional(),
});
export const agentDecisionSchema = z.object({ id: z.string(), createdAt: z.string().datetime(), title: z.string(), summary: z.string(), rationale: z.string(), policy: policyResultSchema });
export const integrationStatusSchema = z.object({ name: z.string(), status: z.enum(["DEMO", "NOT_CONNECTED", "UNAVAILABLE", "FUTURE"]), message: z.string() });
export const walletConnectionSchema = z.object({
  // TEST_SIGNER is a local-development key held by the dev server; never a user provider.
  provider: z.enum(["CIRCLE_USER_CONTROLLED", "CIRCLE_MODULAR", "INJECTED_METAMASK", "INJECTED_RABBY", "TEST_SIGNER"]),
  custody: z.literal("USER_CONTROLLED"),
  accountType: z.enum(["EOA", "SCA", "MSCA"]),
  walletId: z.string().min(1).max(128).optional(),
  // Public WebAuthn metadata only. No raw credential, signature or private key.
  passkey: z.object({ id: z.string().min(1).max(2048), publicKey: z.string().regex(/^0x04[\da-fA-F]{128}$/) }).optional(),
  chain: z.literal("ARC-TESTNET"),
  chainId: z.literal(5_042_002),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  label: z.string().trim().min(1).max(60),
  connectedAt: z.string().datetime(),
});
export const walletSnapshotSchema = z.object({
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chain: z.literal("ARC-TESTNET"),
  chainId: z.literal(5_042_002),
  balance: moneySchema.extend({ currency: z.literal("USDC"), decimals: z.literal(6) }),
  blockNumber: z.string().regex(/^\d+$/),
  observedAt: z.string().datetime(),
});
const strategyBpsSchema = z.object({ LIQUID: z.number().int().min(0).max(10_000), MORPHO: z.number().int().min(0).max(10_000), USYC: z.number().int().min(0).max(10_000), BTC_RESERVE: z.number().int().min(0).max(10_000) });
const strategyEnabledSchema = z.object({ LIQUID: z.boolean(), MORPHO: z.boolean(), USYC: z.boolean(), BTC_RESERVE: z.boolean() });
export const treasuryPolicySchema = z.object({
  safetyBuffer: moneySchema, minimumLiquidityCoverageBps: z.number().int().min(0).max(100_000), obligationHorizonDays: z.literal(30),
  strategyCapsBps: strategyBpsSchema, enabledStrategies: strategyEnabledSchema,
  liquidityWaterfall: z.tuple([z.literal("LIQUID_USDC"), z.literal("MORPHO"), z.literal("USYC"), z.literal("BTC_CREDIT"), z.literal("BTC_SALE")]),
});
const treasuryWorkspaceFields = {
  paymentReservations: z.array(z.object({ proposalId: z.string().uuid(), obligationId: z.string(), amount: moneySchema, feeReserve: moneySchema })).optional(),
  updatedAt: z.string().datetime(), totalTreasury: moneySchema, liquidUsdc: moneySchema, pendingTransactions: moneySchema,
  obligations: z.array(obligationSchema), strategies: z.array(strategyPositionSchema), policy: treasuryPolicySchema,
  targetAllocationsBps: strategyBpsSchema.refine((value) => Object.values(value).reduce((sum, item) => sum + item, 0) === 10_000, "Target allocations must total 100%"),
  activities: z.array(activityEntrySchema), decisions: z.array(agentDecisionSchema), integrations: z.array(integrationStatusSchema),
};
export const legacyTreasuryWorkspaceSchema = z.object({ schemaVersion: z.literal(1), ...treasuryWorkspaceFields });
export const stage2TreasuryWorkspaceSchema = z.object({
  schemaVersion: z.literal(2),
  treasuryMode: z.enum(["LOCAL_DEMO", "ARC_TESTNET_WALLET"]),
  walletConnection: z.object({
    provider: z.literal("CIRCLE_AGENT_WALLET"), chain: z.literal("ARC-TESTNET"), chainId: z.literal(5_042_002),
    address: z.string().regex(/^0x[a-fA-F0-9]{40}$/), label: z.string().trim().min(1).max(60), connectedAt: z.string().datetime(),
  }).nullable(),
  ...treasuryWorkspaceFields,
});
export const stage4TreasuryWorkspaceSchema = z.object({
  schemaVersion: z.literal(3),
  treasuryMode: z.enum(["LOCAL_DEMO", "ARC_TESTNET_WALLET"]),
  walletConnection: z.object({
    provider: z.enum(["CIRCLE_AGENT_WALLET_READ_ONLY", "CIRCLE_DEVELOPER_CONTROLLED_WALLET"]),
    chain: z.literal("ARC-TESTNET"), chainId: z.literal(5_042_002), address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
    label: z.string().trim().min(1).max(60), connectedAt: z.string().datetime(),
  }).nullable(),
  ...treasuryWorkspaceFields,
});
export const treasuryWorkspaceSchema = z.object({
  schemaVersion: z.literal(4),
  treasuryMode: z.enum(["LOCAL_DEMO", "ARC_TESTNET_WALLET"]),
  walletConnection: walletConnectionSchema.nullable(),
  ...treasuryWorkspaceFields,
}).superRefine((workspace, context) => {
  if (workspace.treasuryMode === "ARC_TESTNET_WALLET" && !workspace.walletConnection) {
    context.addIssue({ code: "custom", path: ["walletConnection"], message: "A wallet connection is required in Arc Testnet mode" });
  }
});

export type Money = z.infer<typeof moneySchema>;
export type Obligation = z.infer<typeof obligationSchema>;
export type StrategyKind = z.infer<typeof strategyKindSchema>;
export type LiquiditySource = z.infer<typeof liquiditySourceSchema>;
export type StrategyPosition = z.infer<typeof strategyPositionSchema>;
export type PolicyResult = z.infer<typeof policyResultSchema>;
export type ActivityEntry = z.infer<typeof activityEntrySchema>;
export type AgentDecision = z.infer<typeof agentDecisionSchema>;
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
export type WalletConnection = z.infer<typeof walletConnectionSchema>;
export type WalletSnapshot = z.infer<typeof walletSnapshotSchema>;
export type TreasuryPolicy = z.infer<typeof treasuryPolicySchema>;
export type TreasuryWorkspace = z.infer<typeof treasuryWorkspaceSchema>;
export type WalletCapability = "READ_BALANCE" | "SIGN" | "SUBMIT_TRANSACTION";
export type WalletReadState =
  | Readonly<{ status: "IDLE" | "LOADING" }>
  | Readonly<{ status: "READY"; snapshot: WalletSnapshot }>
  | Readonly<{ status: "ERROR"; code: "INVALID_ADDRESS" | "WRONG_CHAIN" | "INVALID_USDC" | "RPC_UNAVAILABLE" | "INVALID_RESPONSE"; message: string; staleSnapshot?: WalletSnapshot }>;
export type WalletCapabilities = Readonly<Record<WalletCapability, boolean>>;
export type PolicyViolation = Readonly<{ code: "LIQUIDITY_SHORTFALL" | "MINIMUM_COVERAGE" | "STRATEGY_DISABLED" | "ALLOCATION_CAP"; severity: "REVIEW" | "BLOCKED"; message: string }>;
export type LiquidityStep = Readonly<{ source: LiquiditySource; amount: Money }>;
export type PaymentFeasibility = Readonly<{ obligationId: string; status: "SAFE" | "AT_RISK"; required: Money; availableAfterReserves: Money; shortfall: Money; steps: readonly LiquidityStep[] }>;
export type TreasuryAssessment = Readonly<{ evaluatedAt: string; upcomingObligations: Money; protectedCapital: Money; deployableCapital: Money; safelyAvailableLiquidity: Money; liquidityCoverageBps: number | null; coverageStatus: "SAFE" | "REVIEW" | "AT_RISK" | "NO_OBLIGATIONS"; nextPayment: Obligation | null; nextPaymentFeasibility: PaymentFeasibility | null; violations: readonly PolicyViolation[] }>;
export type AllocationLine = Readonly<{ strategy: StrategyKind; requested: Money; approved: Money; reason: string }>;
export type AllocationPlan = Readonly<{ deployableCapital: Money; lines: readonly AllocationLine[]; unallocatedToLiquid: Money; violations: readonly PolicyViolation[]; status: "PASS" | "REVIEW" }>;
export type ObligationInput = Omit<Obligation, "id" | "status" | "revision" | "paymentReference"> & { status: "DRAFT" | "UPCOMING" };
