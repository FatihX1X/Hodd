import type { AllocationPlan, LiquiditySource, LiquidityStep, Money, Obligation, PaymentFeasibility, PolicyViolation, StrategyKind, TreasuryAssessment, TreasuryWorkspace } from "./models";
import { addMoney, assertCompatible, minMoney, moneyLike, multiplyBps, ratioBps, subtractMoneyFloor } from "./money";

const DAY_MS = 86_400_000;
const strategyOrder: StrategyKind[] = ["MORPHO", "USYC", "BTC_RESERVE"];
const zero = (template: Money) => moneyLike(template, 0n);

export function getProtectedObligations(workspace: TreasuryWorkspace, evaluatedAt: Date): Obligation[] {
  const horizon = evaluatedAt.getTime() + workspace.policy.obligationHorizonDays * DAY_MS;
  return workspace.obligations.filter((item) => (item.status === "UPCOMING" || item.status === "OVERDUE") && new Date(item.dueAt).getTime() <= horizon)
    .sort((left, right) => new Date(left.dueAt).getTime() - new Date(right.dueAt).getTime() || left.id.localeCompare(right.id));
}
export function buildWaterfall(required: Money, sources: readonly { source: LiquiditySource; available: Money }[]) {
  sources.forEach((item) => assertCompatible(required, item.available)); let remaining = required; const steps: LiquidityStep[] = [];
  for (const source of sources) { if (BigInt(remaining.minorUnits) === 0n) break; const amount = minMoney(remaining, source.available); if (BigInt(amount.minorUnits) > 0n) steps.push({ source: source.source, amount }); remaining = subtractMoneyFloor(remaining, amount); }
  return { steps, shortfall: remaining } as const;
}
function liquiditySources(workspace: TreasuryWorkspace) {
  const sourceMap: Record<LiquiditySource, Money> = { LIQUID_USDC: workspace.liquidUsdc, MORPHO: zero(workspace.liquidUsdc), USYC: zero(workspace.liquidUsdc), BTC_CREDIT: zero(workspace.liquidUsdc), BTC_SALE: zero(workspace.liquidUsdc) };
  for (const strategy of workspace.strategies) {
    if (strategy.kind === "MORPHO" && strategy.integration === "DEMO") sourceMap.MORPHO = strategy.redeemable;
    if (strategy.kind === "USYC" && strategy.integration === "DEMO") sourceMap.USYC = strategy.redeemable;
    if (strategy.kind === "BTC_RESERVE" && strategy.integration === "DEMO") sourceMap.BTC_SALE = strategy.redeemable;
  }
  return workspace.policy.liquidityWaterfall.map((source) => ({ source, available: sourceMap[source] }));
}
function paymentFeasibility(workspace: TreasuryWorkspace, obligation: Obligation, protectedObligations: Obligation[]): PaymentFeasibility {
  const sources = liquiditySources(workspace);
  const earlier = protectedObligations.filter((item) => item.id !== obligation.id && new Date(item.dueAt) <= new Date(obligation.dueAt));
  const reserve = addMoney(workspace.policy.safetyBuffer, workspace.pendingTransactions, ...earlier.map((item) => item.amount));
  const reserved = buildWaterfall(reserve, sources);
  const remainingBySource = sources.map((source) => ({ source: source.source, available: subtractMoneyFloor(source.available, reserved.steps.find((step) => step.source === source.source)?.amount ?? zero(source.available)) }));
  const plan = buildWaterfall(obligation.amount, remainingBySource);
  return { obligationId: obligation.id, status: BigInt(plan.shortfall.minorUnits) === 0n ? "SAFE" : "AT_RISK", required: obligation.amount, availableAfterReserves: addMoney(zero(obligation.amount), ...remainingBySource.map((item) => item.available)), shortfall: plan.shortfall, steps: plan.steps };
}
export function assessTreasury(workspace: TreasuryWorkspace, evaluatedAt = new Date()): TreasuryAssessment {
  const obligations = getProtectedObligations(workspace, evaluatedAt);
  const upcoming = addMoney(zero(workspace.totalTreasury), ...obligations.map((item) => item.amount));
  const protectedCapital = addMoney(upcoming, workspace.policy.safetyBuffer, workspace.pendingTransactions);
  const deployableCapital = subtractMoneyFloor(workspace.totalTreasury, protectedCapital);
  const sources = liquiditySources(workspace);
  const safeLiquidity = addMoney(zero(workspace.liquidUsdc), ...sources.map((item) => item.available));
  const coverage = ratioBps(safeLiquidity, upcoming);
  const violations: PolicyViolation[] = [];
  if (BigInt(subtractMoneyFloor(protectedCapital, safeLiquidity).minorUnits) > 0n) violations.push({ code: "LIQUIDITY_SHORTFALL", severity: "BLOCKED", message: "Available and safely redeemable liquidity cannot protect obligations and the safety buffer." });
  if (coverage !== null && coverage < workspace.policy.minimumLiquidityCoverageBps) violations.push({ code: "MINIMUM_COVERAGE", severity: "REVIEW", message: "Liquidity coverage is below the configured minimum." });
  const nextPayment = obligations[0] ?? null;
  const coverageStatus = coverage === null ? "NO_OBLIGATIONS" : violations.some((item) => item.severity === "BLOCKED") ? "AT_RISK" : coverage < workspace.policy.minimumLiquidityCoverageBps ? "REVIEW" : "SAFE";
  return { evaluatedAt: evaluatedAt.toISOString(), upcomingObligations: upcoming, protectedCapital, deployableCapital, safelyAvailableLiquidity: safeLiquidity, liquidityCoverageBps: coverage, coverageStatus, nextPayment, nextPaymentFeasibility: nextPayment ? paymentFeasibility(workspace, nextPayment, obligations) : null, violations };
}
export function previewAllocation(workspace: TreasuryWorkspace, assessment = assessTreasury(workspace)): AllocationPlan {
  const deployable = assessment.deployableCapital; const violations: PolicyViolation[] = [];
  const lines = strategyOrder.map((strategy) => {
    const requested = multiplyBps(deployable, workspace.targetAllocationsBps[strategy]); const cap = multiplyBps(deployable, workspace.policy.strategyCapsBps[strategy]); let approved = requested; let reason = "Within the configured allocation limit.";
    if (!workspace.policy.enabledStrategies[strategy]) { approved = zero(deployable); reason = "Strategy is disabled or unavailable; capital stays liquid."; if (BigInt(requested.minorUnits) > 0n) violations.push({ code: "STRATEGY_DISABLED", severity: "BLOCKED", message: `${strategy} is not enabled.` }); }
    else if (BigInt(requested.minorUnits) > BigInt(cap.minorUnits)) { approved = cap; reason = "Requested allocation was clipped to the configured cap; the remainder stays liquid."; violations.push({ code: "ALLOCATION_CAP", severity: "REVIEW", message: `${strategy} exceeds its configured cap.` }); }
    return { strategy, requested, approved, reason };
  });
  const approvedRisk = addMoney(zero(deployable), ...lines.map((line) => line.approved));
  return { deployableCapital: deployable, lines, unallocatedToLiquid: subtractMoneyFloor(deployable, approvedRisk), violations, status: violations.length ? "REVIEW" : "PASS" };
}

