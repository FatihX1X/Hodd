import { z } from "zod";

export const moneySchema = z.object({ currency: z.enum(["USDC", "USD"]), minorUnits: z.string().regex(/^\d+$/), decimals: z.number().int().nonnegative() });
export const obligationSchema = z.object({
  id: z.string().min(1), title: z.string().trim().min(1).max(80),
  category: z.enum(["PAYROLL", "VENDOR", "SUBSCRIPTION", "RENT", "TAX", "OTHER"]), amount: moneySchema,
  dueAt: z.string().datetime(), recipient: z.string().trim().max(120).nullable(),
  priority: z.enum(["CRITICAL", "HIGH", "NORMAL", "LOW"]), status: z.enum(["UPCOMING", "DRAFT", "PAID", "OVERDUE"]),
  description: z.string().trim().max(500),
});
export const strategyKindSchema = z.enum(["LIQUID", "MORPHO", "USYC", "BTC_RESERVE"]);
export const liquiditySourceSchema = z.enum(["LIQUID_USDC", "MORPHO", "USYC", "BTC_CREDIT", "BTC_SALE"]);
export const strategyPositionSchema = z.object({
  id: z.string(), name: z.string(), kind: strategyKindSchema, balance: moneySchema, redeemable: moneySchema,
  apyBps: z.number().int().nullable(), risk: z.enum(["LOW", "MODERATE", "HIGH"]),
  liquidity: z.enum(["INSTANT", "VARIABLE", "RESTRICTED"]), integration: z.enum(["DEMO", "UNAVAILABLE", "FUTURE"]),
});
export const policyResultSchema = z.object({ status: z.enum(["PASS", "REVIEW", "BLOCKED", "NOT_EVALUATED"]), label: z.string(), reason: z.string() });
export const activityEntrySchema = z.object({
  id: z.string(), occurredAt: z.string().datetime(), actor: z.enum(["HUMAN", "AGENT", "SYSTEM"]), action: z.string(), summary: z.string(), reason: z.string(),
  policy: policyResultSchema, approval: z.enum(["NOT_REQUIRED", "PENDING", "APPROVED", "DENIED"]),
  execution: z.enum(["LOCAL_ONLY", "DEMO_ONLY", "NOT_STARTED", "COMPLETE", "FAILED"]),
});
export const agentDecisionSchema = z.object({ id: z.string(), createdAt: z.string().datetime(), title: z.string(), summary: z.string(), rationale: z.string(), policy: policyResultSchema });
export const integrationStatusSchema = z.object({ name: z.string(), status: z.enum(["DEMO", "NOT_CONNECTED", "UNAVAILABLE", "FUTURE"]), message: z.string() });
const strategyBpsSchema = z.object({ LIQUID: z.number().int().min(0).max(10_000), MORPHO: z.number().int().min(0).max(10_000), USYC: z.number().int().min(0).max(10_000), BTC_RESERVE: z.number().int().min(0).max(10_000) });
const strategyEnabledSchema = z.object({ LIQUID: z.boolean(), MORPHO: z.boolean(), USYC: z.boolean(), BTC_RESERVE: z.boolean() });
export const treasuryPolicySchema = z.object({
  safetyBuffer: moneySchema, minimumLiquidityCoverageBps: z.number().int().min(0).max(100_000), obligationHorizonDays: z.literal(30),
  strategyCapsBps: strategyBpsSchema, enabledStrategies: strategyEnabledSchema,
  liquidityWaterfall: z.tuple([z.literal("LIQUID_USDC"), z.literal("MORPHO"), z.literal("USYC"), z.literal("BTC_CREDIT"), z.literal("BTC_SALE")]),
});
export const treasuryWorkspaceSchema = z.object({
  schemaVersion: z.literal(1), updatedAt: z.string().datetime(), totalTreasury: moneySchema, liquidUsdc: moneySchema, pendingTransactions: moneySchema,
  obligations: z.array(obligationSchema), strategies: z.array(strategyPositionSchema), policy: treasuryPolicySchema,
  targetAllocationsBps: strategyBpsSchema.refine((value) => Object.values(value).reduce((sum, item) => sum + item, 0) === 10_000, "Target allocations must total 100%"),
  activities: z.array(activityEntrySchema), decisions: z.array(agentDecisionSchema), integrations: z.array(integrationStatusSchema),
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
export type TreasuryPolicy = z.infer<typeof treasuryPolicySchema>;
export type TreasuryWorkspace = z.infer<typeof treasuryWorkspaceSchema>;
export type PolicyViolation = Readonly<{ code: "LIQUIDITY_SHORTFALL" | "MINIMUM_COVERAGE" | "STRATEGY_DISABLED" | "ALLOCATION_CAP"; severity: "REVIEW" | "BLOCKED"; message: string }>;
export type LiquidityStep = Readonly<{ source: LiquiditySource; amount: Money }>;
export type PaymentFeasibility = Readonly<{ obligationId: string; status: "SAFE" | "AT_RISK"; required: Money; availableAfterReserves: Money; shortfall: Money; steps: readonly LiquidityStep[] }>;
export type TreasuryAssessment = Readonly<{ evaluatedAt: string; upcomingObligations: Money; protectedCapital: Money; deployableCapital: Money; safelyAvailableLiquidity: Money; liquidityCoverageBps: number | null; coverageStatus: "SAFE" | "REVIEW" | "AT_RISK" | "NO_OBLIGATIONS"; nextPayment: Obligation | null; nextPaymentFeasibility: PaymentFeasibility | null; violations: readonly PolicyViolation[] }>;
export type AllocationLine = Readonly<{ strategy: StrategyKind; requested: Money; approved: Money; reason: string }>;
export type AllocationPlan = Readonly<{ deployableCapital: Money; lines: readonly AllocationLine[]; unallocatedToLiquid: Money; violations: readonly PolicyViolation[]; status: "PASS" | "REVIEW" }>;
export type ObligationInput = Omit<Obligation, "id" | "status"> & { status: "DRAFT" | "UPCOMING" };
