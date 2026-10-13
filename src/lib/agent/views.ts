import { assessPayment } from "@/lib/payments/policy";
import { assessTreasury, effectiveProtectionLeadDays, getProtectedObligations, liquiditySources, protectionPlan, previewAllocation, type ProtectionContext } from "@/lib/treasury/engine";
import type { Money, Obligation, TreasuryWorkspace } from "@/lib/treasury/models";
import { moneyToInput } from "@/lib/treasury/money";

// Pure, JSON-friendly views returned to Claude. Amounts are decimal USDC strings.

export const usdc = (money: Money) => `${moneyToInput(money)} ${money.currency}`;
const pct = (bps: number | null) => bps === null ? null : `${(bps / 100).toFixed(bps % 100 ? 2 : 0)}%`;
const day = (iso: string) => iso.slice(0, 10);

export function obligationView(workspace: TreasuryWorkspace, item: Obligation, evaluatedAt = new Date(), context: ProtectionContext = { autopilotActive: false }) {
  const plan = protectionPlan(workspace, evaluatedAt, context);
  const protectedEntry = plan.protected.find((entry) => entry.obligation.id === item.id);
  return {
    id: item.id, title: item.title, amount: usdc(item.amount), dueDate: day(item.dueAt), status: item.status,
    category: item.category, priority: item.priority, recipient: item.recipient, recipientAddress: item.recipientAddress ?? null,
    description: item.description || null, protectedNow: Boolean(protectedEntry), protectionReason: protectedEntry?.reason ?? null, planned: plan.planned.some((value) => value.id === item.id),
    pendingPayment: Boolean(workspace.paymentReservations?.some((reservation) => reservation.obligationId === item.id)),
  };
}

export function overviewView(workspace: TreasuryWorkspace, evaluatedAt = new Date(), context: ProtectionContext = { autopilotActive: false }) {
  const assessment = assessTreasury(workspace, evaluatedAt, context);
  const next = assessment.nextPayment;
  return {
    evaluatedAt: assessment.evaluatedAt,
    totalTreasury: usdc(workspace.totalTreasury), liquidUsdc: usdc(workspace.liquidUsdc),
    strategies: workspace.strategies.filter((item) => BigInt(item.balance.minorUnits) > 0n || item.kind === "LIQUID").map((item) => ({ kind: item.kind, name: item.name, balance: usdc(item.balance), redeemable: usdc(item.redeemable), integration: item.integration === "DEMO" ? "NOT_CONNECTED" : item.integration })),
    protectedObligations: usdc(assessment.upcomingObligations), plannedObligations: usdc(assessment.plannedObligations), planningHorizonDays: workspace.policy.planningHorizonDays, protectionLeadDays: assessment.protectionLeadDays, safetyBuffer: usdc(workspace.policy.safetyBuffer), pendingPayments: usdc(workspace.pendingTransactions),
    protectedCapital: usdc(assessment.protectedCapital), deployableCapital: usdc(assessment.deployableCapital),
    safelyAvailableLiquidity: usdc(assessment.safelyAvailableLiquidity), liquidityCoverage: pct(assessment.liquidityCoverageBps), minimumCoverage: pct(workspace.policy.minimumLiquidityCoverageBps), coverageStatus: assessment.coverageStatus,
    nextPayment: next ? { ...obligationView(workspace, next, evaluatedAt, context), feasibility: assessment.nextPaymentFeasibility ? { status: assessment.nextPaymentFeasibility.status, shortfall: usdc(assessment.nextPaymentFeasibility.shortfall), fundingSteps: assessment.nextPaymentFeasibility.steps.map((step) => ({ source: step.source, amount: usdc(step.amount) })) } : null } : null,
    violations: assessment.violations,
  };
}

export function allocationView(workspace: TreasuryWorkspace, evaluatedAt = new Date(), context: ProtectionContext = { autopilotActive: false }) {
  const plan = previewAllocation(workspace, assessTreasury(workspace, evaluatedAt, context), context);
  return { deployableCapital: usdc(plan.deployableCapital), status: plan.status, lines: plan.lines.map((line) => ({ strategy: line.strategy, requested: usdc(line.requested), approved: usdc(line.approved), reason: line.reason })), stayingLiquid: usdc(plan.unallocatedToLiquid), violations: plan.violations, targets: Object.fromEntries(Object.entries(workspace.targetAllocationsBps).map(([key, value]) => [key, pct(value)])), note: "A preview only; Hodd never moves funds without your approval and wallet signature." };
}

export function policyView(workspace: TreasuryWorkspace, context: ProtectionContext = { autopilotActive: false }) {
  const policy = workspace.policy;
  return {
    safetyBuffer: usdc(policy.safetyBuffer), minimumLiquidityCoverage: pct(policy.minimumLiquidityCoverageBps), planningHorizonDays: policy.planningHorizonDays, protectionLeadDays: policy.protectionLeadDays, effectiveProtectionLeadDays: effectiveProtectionLeadDays(policy, context),
    strategyCaps: Object.fromEntries(Object.entries(policy.strategyCapsBps).map(([key, value]) => [key, pct(value)])),
    enabledStrategies: policy.enabledStrategies, liquidityWaterfall: policy.liquidityWaterfall,
    targetAllocations: Object.fromEntries(Object.entries(workspace.targetAllocationsBps).map(([key, value]) => [key, pct(value)])),
  };
}

/**
 * "Can I pay it?" — the same server policy Hodd enforces before a real payment,
 * plus a funding plan: how much to withdraw from Morpho first when liquid USDC is short.
 */
export function paymentCheckView(workspace: TreasuryWorkspace, obligation: Obligation, fee: Money, evaluatedAt = new Date(), context: ProtectionContext = { autopilotActive: false }) {
  const policy = assessPayment(workspace, obligation, fee, evaluatedAt, context);
  const earlier = getProtectedObligations(workspace, evaluatedAt, context).filter((item) => item.id !== obligation.id && Date.parse(item.dueAt) <= Date.parse(obligation.dueAt));
  const reserved = [workspace.policy.safetyBuffer, workspace.pendingTransactions, ...earlier.map((item) => item.amount)].reduce((sum, item) => sum + BigInt(item.minorUnits), 0n);
  const required = reserved + BigInt(obligation.amount.minorUnits) + BigInt(fee.minorUnits);
  const liquid = BigInt(workspace.liquidUsdc.minorUnits);
  const available = (source: "MORPHO" | "USYC") => liquiditySources(workspace, evaluatedAt).filter((item) => item.source === source).reduce((sum, item) => sum + BigInt(item.available.minorUnits), 0n);
  const redeemable = available("MORPHO"), fromUsyc = available("USYC");
  const shortfall = required > liquid ? required - liquid : 0n;
  const money = (minorUnits: bigint): Money => ({ currency: "USDC", decimals: 6, minorUnits: minorUnits.toString() });
  const funding = shortfall === 0n ? { action: "NONE" as const, message: "Liquid USDC already covers this payment and everything that must stay protected." }
    : shortfall <= redeemable ? { action: "WITHDRAW_FROM_MORPHO" as const, amount: usdc(money(shortfall)), message: `Withdraw at least ${usdc(money(shortfall))} from Morpho first, then pay.` }
    // Morpho is used first (waterfall order); the rest comes from the wallet's share of Hodd's USYC pool, withdrawn as USDC on the Strategies page.
    : shortfall <= redeemable + fromUsyc ? { action: "REDEEM_USYC" as const, amount: usdc(money(shortfall - redeemable)), message: `${redeemable > 0n ? `Withdraw ${usdc(money(redeemable))} from Morpho and w` : "W"}ithdraw at least ${usdc(money(shortfall - redeemable))} from the USYC pool on the Strategies page (your own wallet signs it) first, then pay.` }
    : { action: "INSUFFICIENT" as const, missing: usdc(money(shortfall - redeemable - fromUsyc)), message: `Even after withdrawing everything redeemable from Morpho${fromUsyc > 0n ? " and USYC" : ""}, ${usdc(money(shortfall - redeemable - fromUsyc))} is missing.` };
  return {
    obligation: obligationView(workspace, obligation, evaluatedAt, context), canPayNow: policy.status === "PASS", policy,
    estimatedFee: usdc(fee), keptProtected: usdc(money(reserved)), requiredLiquid: usdc(money(required)), liquidUsdc: usdc(workspace.liquidUsdc), redeemableFromMorpho: usdc(money(redeemable)), redeemableFromUsyc: usdc(money(fromUsyc)), funding,
    nextStep: policy.status === "PASS" ? "Ask Hodd to request this payment, then confirm and sign it in Hodd." : funding.action === "WITHDRAW_FROM_MORPHO" ? "Request a Morpho withdrawal first; after it settles, request the payment." : funding.action === "REDEEM_USYC" ? "Free the cash first: withdraw from Morpho if needed and from the USYC pool on the Strategies page; then request the payment." : "Payment is not possible with current funds.",
  };
}
