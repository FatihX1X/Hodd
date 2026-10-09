import { moneyToInput } from "@/lib/treasury/money";
import type { Money, TreasuryAssessment, TreasuryWorkspace } from "@/lib/treasury/models";

const amount = (money: Money) => moneyToInput(money);

/**
 * The slice of the workspace Hoddie's language service sees. Recipient addresses, payment
 * references and wallet identifiers are never included. Everything here is read-only context.
 */
export function buildSnapshot(workspace: TreasuryWorkspace, assessment: TreasuryAssessment | null, now: Date, pending: { kind: string; summary: string } | null) {
  return {
    today: now.toISOString().slice(0, 10),
    currency: "USDC",
    mode: workspace.treasuryMode === "ARC_TESTNET_WALLET" ? "live wallet" : "local demo",
    figuresPaused: assessment === null,
    totals: { treasury: amount(workspace.totalTreasury), liquid: amount(workspace.liquidUsdc), pendingTransactions: amount(workspace.pendingTransactions) },
    assessment: assessment ? {
      upcomingObligations: amount(assessment.upcomingObligations), protectedCapital: amount(assessment.protectedCapital), deployableCapital: amount(assessment.deployableCapital),
      liquidityCoveragePercent: assessment.liquidityCoverageBps === null ? null : assessment.liquidityCoverageBps / 100, coverageStatus: assessment.coverageStatus,
      nextPayment: assessment.nextPayment ? { id: assessment.nextPayment.id, feasibility: assessment.nextPaymentFeasibility?.status ?? null, shortfall: assessment.nextPaymentFeasibility ? amount(assessment.nextPaymentFeasibility.shortfall) : null } : null,
      violations: assessment.violations.map((item) => item.message),
    } : null,
    obligations: workspace.obligations.slice(0, 60).map((item) => ({ id: item.id, title: item.title, category: item.category, amount: amount(item.amount), dueDate: item.dueAt.slice(0, 10), status: item.status, priority: item.priority, recipient: item.recipient, locked: Boolean(workspace.paymentReservations?.some((reservation) => reservation.obligationId === item.id)) })),
    policy: { safetyBuffer: amount(workspace.policy.safetyBuffer), minimumLiquidityCoveragePercent: workspace.policy.minimumLiquidityCoverageBps / 100, horizonDays: workspace.policy.obligationHorizonDays, capsPercent: Object.fromEntries(Object.entries(workspace.policy.strategyCapsBps).map(([key, bps]) => [key, bps / 100])), enabledStrategies: workspace.policy.enabledStrategies },
    targetsPercent: Object.fromEntries(Object.entries(workspace.targetAllocationsBps).map(([key, bps]) => [key, bps / 100])),
    strategies: workspace.strategies.map((item) => ({ kind: item.kind, name: item.name, balance: amount(item.balance), apyPercent: item.apyBps === null ? null : item.apyBps / 100, liquidity: item.liquidity, risk: item.risk })),
    recentActivity: workspace.activities.slice(0, 5).map((item) => ({ at: item.occurredAt.slice(0, 10), actor: item.actor, action: item.action })),
    paymentPending: Boolean(workspace.paymentReservations?.length),
    pendingProposal: pending,
  };
}
