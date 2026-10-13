import type { AllocationPlan, LiquiditySource, LiquidityStep, Money, Obligation, PaymentFeasibility, PolicyViolation, StrategyKind, TreasuryAssessment, TreasuryPolicy, TreasuryWorkspace } from "./models";
import { addMoney, assertCompatible, minMoney, moneyLike, multiplyBps, ratioBps, subtractMoneyFloor } from "./money";

const DAY_MS = 86_400_000;
const strategyOrder: StrategyKind[] = ["MORPHO", "USYC", "BTC_RESERVE"];
const zero = (template: Money) => moneyLike(template, 0n);

export interface ProtectionContext { autopilotActive: boolean }
export type ProtectionReason = "LEAD_TIME" | "OVERDUE" | "STALE_DATA" | "LOW_VAULT_LIQUIDITY";
const manualContext: ProtectionContext = { autopilotActive: false };
export function effectiveProtectionLeadDays(policy: TreasuryPolicy, context: ProtectionContext = manualContext): number {
  return policy.protectionLeadDays ?? (context.autopilotActive ? 3 : 7);
}
/** Scheduled planning records, excluding amounts already counted in pending transactions. */
export function getPlanningObligations(workspace: TreasuryWorkspace, evaluatedAt: Date): Obligation[] {
  const horizon = evaluatedAt.getTime() + workspace.policy.planningHorizonDays * DAY_MS;
  const reserved = new Set(workspace.paymentReservations?.map((item) => item.obligationId));
  return workspace.obligations.filter((item) => !reserved.has(item.id) && (item.status === "UPCOMING" || item.status === "OVERDUE") && (item.status === "OVERDUE" || Date.parse(item.dueAt) <= horizon))
    .sort((left, right) => Date.parse(left.dueAt) - Date.parse(right.dueAt) || left.id.localeCompare(right.id));
}
function relevantStrategies(workspace: TreasuryWorkspace) {
  // Unfunded, unavailable future integrations are placeholders, not funding sources.
  return workspace.strategies.filter((item) => item.kind !== "LIQUID" && (item.kind === "MORPHO" || BigInt(item.balance.minorUnits) > 0n || BigInt(item.redeemable.minorUnits) > 0n));
}
function strategyIsFresh(strategy: TreasuryWorkspace["strategies"][number], evaluatedAt: Date): boolean {
  const observedAt = strategy.observedAt ? Date.parse(strategy.observedAt) : NaN;
  return Number.isFinite(observedAt) && observedAt <= evaluatedAt.getTime() + 5_000 && evaluatedAt.getTime() - observedAt <= 15 * 60_000
    && strategy.liquidityStatus === "READY" && (strategy.integration === "LIVE" || strategy.integration === "DEMO");
}
export function protectionPlan(workspace: TreasuryWorkspace, evaluatedAt: Date, context: ProtectionContext = manualContext): { protected: { obligation: Obligation; reason: ProtectionReason }[]; planned: Obligation[] } {
  const obligations = getPlanningObligations(workspace, evaluatedAt);
  const leadBoundary = evaluatedAt.getTime() + effectiveProtectionLeadDays(workspace.policy, context) * DAY_MS;
  const protectedBills: { obligation: Obligation; reason: ProtectionReason }[] = [];
  const candidates: Obligation[] = [];
  for (const obligation of obligations) {
    if (obligation.status === "OVERDUE" || Date.parse(obligation.dueAt) < evaluatedAt.getTime()) protectedBills.push({ obligation, reason: "OVERDUE" });
    else if (Date.parse(obligation.dueAt) <= leadBoundary) protectedBills.push({ obligation, reason: "LEAD_TIME" });
    else candidates.push(obligation);
  }
  const strategies = relevantStrategies(workspace);
  // No vault at all is not stale data; it simply cannot fund planned bills (capacity 0 below).
  const stale = strategies.some((item) => !strategyIsFresh(item, evaluatedAt));
  const sources = liquiditySources(workspace, evaluatedAt);
  const reserve = addMoney(workspace.policy.safetyBuffer, workspace.pendingTransactions, ...protectedBills.map((item) => item.obligation.amount));
  const reserved = buildWaterfall(reserve, sources);
  const vaultLiquidity = addMoney(zero(workspace.liquidUsdc), ...sources.filter((item) => item.source !== "LIQUID_USDC").map((item) => subtractMoneyFloor(item.available, reserved.steps.find((step) => step.source === item.source)?.amount ?? zero(item.available))));
  const planned: Obligation[] = [];
  let plannedTotal = 0n;
  let exhausted = false;
  for (const obligation of candidates) {
    plannedTotal += BigInt(obligation.amount.minorUnits);
    exhausted ||= plannedTotal > BigInt(vaultLiquidity.minorUnits);
    if (stale || exhausted) protectedBills.push({ obligation, reason: stale ? "STALE_DATA" : "LOW_VAULT_LIQUIDITY" });
    else planned.push(obligation);
  }
  protectedBills.sort((left, right) => Date.parse(left.obligation.dueAt) - Date.parse(right.obligation.dueAt) || left.obligation.id.localeCompare(right.obligation.id));
  return { protected: protectedBills, planned };
}
export function getProtectedObligations(workspace: TreasuryWorkspace, evaluatedAt: Date, context: ProtectionContext = manualContext): Obligation[] {
  return protectionPlan(workspace, evaluatedAt, context).protected.map((item) => item.obligation);
}
export function buildWaterfall(required: Money, sources: readonly { source: LiquiditySource; available: Money }[]) {
  sources.forEach((item) => assertCompatible(required, item.available)); let remaining = required; const steps: LiquidityStep[] = [];
  for (const source of sources) { if (BigInt(remaining.minorUnits) === 0n) break; const amount = minMoney(remaining, source.available); if (BigInt(amount.minorUnits) > 0n) steps.push({ source: source.source, amount }); remaining = subtractMoneyFloor(remaining, amount); }
  return { steps, shortfall: remaining } as const;
}
export function liquiditySources(workspace: TreasuryWorkspace, evaluatedAt = new Date()) {
  const sourceMap: Record<LiquiditySource, Money> = { LIQUID_USDC: workspace.liquidUsdc, MORPHO: zero(workspace.liquidUsdc), USYC: zero(workspace.liquidUsdc), BTC_CREDIT: zero(workspace.liquidUsdc), BTC_SALE: zero(workspace.liquidUsdc) };
  for (const strategy of workspace.strategies) {
    if (!strategyIsFresh(strategy, evaluatedAt)) continue;
    if (strategy.kind === "MORPHO" && (strategy.integration === "DEMO" || strategy.integration === "LIVE")) sourceMap.MORPHO = addMoney(sourceMap.MORPHO, strategy.redeemable);
    // LIVE USYC is the wallet's share of Hodd's pool, read fresh and redeemable only while Circle permits the pool (liquidityStatus).
    if (strategy.kind === "USYC" && (strategy.integration === "DEMO" || strategy.integration === "LIVE")) sourceMap.USYC = addMoney(sourceMap.USYC, strategy.redeemable);
    if (strategy.kind === "BTC_RESERVE" && strategy.integration === "DEMO") sourceMap.BTC_SALE = addMoney(sourceMap.BTC_SALE, strategy.redeemable);
  }
  return workspace.policy.liquidityWaterfall.map((source) => ({ source, available: sourceMap[source] }));
}
function paymentFeasibility(workspace: TreasuryWorkspace, obligation: Obligation, protectedObligations: Obligation[], evaluatedAt: Date): PaymentFeasibility {
  const sources = liquiditySources(workspace, evaluatedAt);
  const earlier = protectedObligations.filter((item) => item.id !== obligation.id && new Date(item.dueAt) <= new Date(obligation.dueAt));
  const reserve = addMoney(workspace.policy.safetyBuffer, workspace.pendingTransactions, ...earlier.map((item) => item.amount));
  const reserved = buildWaterfall(reserve, sources);
  const remainingBySource = sources.map((source) => ({ source: source.source, available: subtractMoneyFloor(source.available, reserved.steps.find((step) => step.source === source.source)?.amount ?? zero(source.available)) }));
  const plan = buildWaterfall(obligation.amount, remainingBySource);
  return { obligationId: obligation.id, status: BigInt(plan.shortfall.minorUnits) === 0n ? "SAFE" : "AT_RISK", required: obligation.amount, availableAfterReserves: addMoney(zero(obligation.amount), ...remainingBySource.map((item) => item.available)), shortfall: plan.shortfall, steps: plan.steps };
}
export function assessTreasury(workspace: TreasuryWorkspace, evaluatedAt = new Date(), context: ProtectionContext = manualContext): TreasuryAssessment {
  const plan = protectionPlan(workspace, evaluatedAt, context);
  const obligations = plan.protected.map((item) => item.obligation);
  const upcoming = addMoney(zero(workspace.totalTreasury), ...obligations.map((item) => item.amount));
  const protectedCapital = addMoney(upcoming, workspace.policy.safetyBuffer, workspace.pendingTransactions);
  const deployableCapital = subtractMoneyFloor(workspace.totalTreasury, protectedCapital);
  const sources = liquiditySources(workspace, evaluatedAt);
  const safeLiquidity = addMoney(zero(workspace.liquidUsdc), ...sources.map((item) => item.available));
  const coverage = ratioBps(safeLiquidity, upcoming);
  const violations: PolicyViolation[] = [];
  if (BigInt(subtractMoneyFloor(protectedCapital, safeLiquidity).minorUnits) > 0n) violations.push({ code: "LIQUIDITY_SHORTFALL", severity: "BLOCKED", message: "Available and safely redeemable liquidity cannot protect obligations and the safety buffer." });
  if (coverage !== null && coverage < workspace.policy.minimumLiquidityCoverageBps) violations.push({ code: "MINIMUM_COVERAGE", severity: "REVIEW", message: "Liquidity coverage is below the configured minimum." });
  const nextPayment = obligations[0] ?? null;
  const coverageStatus = coverage === null ? "NO_OBLIGATIONS" : violations.some((item) => item.severity === "BLOCKED") ? "AT_RISK" : coverage < workspace.policy.minimumLiquidityCoverageBps ? "REVIEW" : "SAFE";
  return { evaluatedAt: evaluatedAt.toISOString(), upcomingObligations: upcoming, plannedObligations: addMoney(zero(workspace.totalTreasury), ...plan.planned.map((item) => item.amount)), protectionLeadDays: effectiveProtectionLeadDays(workspace.policy, context), protectedCapital, deployableCapital, safelyAvailableLiquidity: safeLiquidity, liquidityCoverageBps: coverage, coverageStatus, nextPayment, nextPaymentFeasibility: nextPayment ? paymentFeasibility(workspace, nextPayment, obligations, evaluatedAt) : null, violations };
}
/** Funding plan for one protected obligation (earlier obligations, the buffer and pending transactions are reserved first). */
export function assessPayment(workspace: TreasuryWorkspace, obligationId: string, evaluatedAt = new Date(), context: ProtectionContext = manualContext): PaymentFeasibility | null {
  const protectedObligations = getProtectedObligations(workspace, evaluatedAt, context);
  const obligation = protectedObligations.find((item) => item.id === obligationId);
  return obligation ? paymentFeasibility(workspace, obligation, protectedObligations, evaluatedAt) : null;
}
export function previewAllocation(workspace: TreasuryWorkspace, assessment: TreasuryAssessment | undefined = undefined, context: ProtectionContext = manualContext): AllocationPlan {
  const deployable = (assessment ?? assessTreasury(workspace, new Date(), context)).deployableCapital; const violations: PolicyViolation[] = [];
  const lines = strategyOrder.map((strategy) => {
    const requested = multiplyBps(deployable, workspace.targetAllocationsBps[strategy]); const cap = multiplyBps(deployable, workspace.policy.strategyCapsBps[strategy]); let approved = requested; let reason = "Within the configured allocation limit.";
    if (!workspace.policy.enabledStrategies[strategy]) { approved = zero(deployable); reason = "Strategy is disabled or unavailable; capital stays liquid."; if (BigInt(requested.minorUnits) > 0n) violations.push({ code: "STRATEGY_DISABLED", severity: "BLOCKED", message: `${strategy} is not enabled.` }); }
    else if (BigInt(requested.minorUnits) > BigInt(cap.minorUnits)) { approved = cap; reason = "Requested allocation was clipped to the configured cap; the remainder stays liquid."; violations.push({ code: "ALLOCATION_CAP", severity: "REVIEW", message: `${strategy} exceeds its configured cap.` }); }
    return { strategy, requested, approved, reason };
  });
  const approvedRisk = addMoney(zero(deployable), ...lines.map((line) => line.approved));
  return { deployableCapital: deployable, lines, unallocatedToLiquid: subtractMoneyFloor(deployable, approvedRisk), violations, status: violations.length ? "REVIEW" : "PASS" };
}
