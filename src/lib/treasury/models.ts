import { z } from "zod";

export const moneySchema = z.object({
  currency: z.enum(["USDC", "USD"]),
  minorUnits: z.string().regex(/^\d+$/),
  decimals: z.number().int().nonnegative(),
});

export const obligationSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.enum(["PAYROLL", "VENDOR", "SUBSCRIPTION", "RENT", "TAX", "OTHER"]),
  amount: moneySchema,
  dueAt: z.string().datetime(),
  recipient: z.string().nullable(),
  priority: z.enum(["CRITICAL", "HIGH", "NORMAL", "LOW"]),
  status: z.enum(["UPCOMING", "DRAFT", "PAID", "OVERDUE"]),
  description: z.string(),
});

export const strategyPositionSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.enum(["LIQUID", "MORPHO", "USYC", "BTC_RESERVE"]),
  balance: moneySchema,
  apyBps: z.number().int().nullable(),
  risk: z.enum(["LOW", "MODERATE", "HIGH"]),
  liquidity: z.enum(["INSTANT", "VARIABLE", "RESTRICTED"]),
  integration: z.enum(["DEMO", "UNAVAILABLE", "FUTURE"]),
});

export const allocationSchema = z.object({
  strategyId: z.string(),
  label: z.string(),
  percentageBps: z.number().int().min(0).max(10_000),
  tone: z.enum(["mint", "blue", "sand", "slate"]),
});

export const policyResultSchema = z.object({
  status: z.enum(["PASS", "REVIEW", "BLOCKED", "NOT_EVALUATED"]),
  label: z.string(),
  reason: z.string(),
});

export const activityEntrySchema = z.object({
  id: z.string(),
  occurredAt: z.string().datetime(),
  actor: z.enum(["HUMAN", "AGENT", "SYSTEM"]),
  action: z.string(),
  summary: z.string(),
  reason: z.string(),
  policy: policyResultSchema,
  approval: z.enum(["NOT_REQUIRED", "PENDING", "APPROVED", "DENIED"]),
  execution: z.enum(["DEMO_ONLY", "NOT_STARTED", "COMPLETE", "FAILED"]),
});

export const agentDecisionSchema = z.object({
  id: z.string(),
  createdAt: z.string().datetime(),
  title: z.string(),
  summary: z.string(),
  rationale: z.string(),
  policy: policyResultSchema,
});

export const integrationStatusSchema = z.object({
  name: z.string(),
  status: z.enum(["DEMO", "NOT_CONNECTED", "UNAVAILABLE", "FUTURE"]),
  message: z.string(),
});

export const portfolioSnapshotSchema = z.object({
  updatedAt: z.string().datetime(),
  totalTreasury: moneySchema,
  liquidUsdc: moneySchema,
  upcomingObligations: moneySchema,
  safetyBuffer: moneySchema,
  deployableCapital: moneySchema,
  pendingTransactions: moneySchema,
  liquidityCoverageBps: z.number().int().nonnegative(),
  nextPaymentId: z.string(),
  nextPaymentStatus: z.enum(["SAFE", "REVIEW", "AT_RISK"]),
  allocations: z.array(allocationSchema),
});

export const treasuryFixtureSchema = z.object({
  portfolio: portfolioSnapshotSchema,
  obligations: z.array(obligationSchema),
  strategies: z.array(strategyPositionSchema),
  activities: z.array(activityEntrySchema),
  decisions: z.array(agentDecisionSchema),
  integrations: z.array(integrationStatusSchema),
});

export type Money = z.infer<typeof moneySchema>;
export type Obligation = z.infer<typeof obligationSchema>;
export type StrategyPosition = z.infer<typeof strategyPositionSchema>;
export type Allocation = z.infer<typeof allocationSchema>;
export type PolicyResult = z.infer<typeof policyResultSchema>;
export type ActivityEntry = z.infer<typeof activityEntrySchema>;
export type AgentDecision = z.infer<typeof agentDecisionSchema>;
export type IntegrationStatus = z.infer<typeof integrationStatusSchema>;
export type PortfolioSnapshot = z.infer<typeof portfolioSnapshotSchema>;
export type TreasuryFixture = z.infer<typeof treasuryFixtureSchema>;
