/**
 * Display-only projections of the workspace. Everything here is derived from the same inputs the
 * Treasury Engine uses; nothing is stored, nothing is invented and no amount computed here
 * authorizes or limits a transaction (the engine and the server remain authoritative).
 */
import { getProtectedObligations } from "./engine";
import { formatMoney, formatPercentFromBps } from "./format";
import type { Money, Obligation, StrategyKind, StrategyPosition, TreasuryAssessment, TreasuryPolicy, TreasuryWorkspace } from "./models";

const DAY_MS = 86_400_000;
export const strategyLabels: Record<StrategyKind, string> = { LIQUID: "Liquid USDC", MORPHO: "Morpho", USYC: "USYC", BTC_RESERVE: "BTC Reserve" };
export const liquidityLabels = { INSTANT: "Instant", VARIABLE: "Variable", RESTRICTED: "Restricted" } as const;

/** Display number from minor units. Never feed this back into financial logic. */
export const usdcNumber = (money: Money) => Number(BigInt(money.minorUnits)) / 10 ** money.decimals;
const utcDay = (date: Date) => Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());

export type RunwayPoint = Readonly<{ day: number; at: number; value: number; due: readonly { id: string; title: string; amount: number }[] }>;
export type RunwaySeries = Readonly<{ points: readonly RunwayPoint[]; start: number; buffer: number; horizonDays: number; firstBelowBufferDay: number | null; firstBelowZeroDay: number | null }>;

/** Treasury balance after each protected obligation falls due, day by day, over the policy horizon. */
export function runwayProjection(workspace: TreasuryWorkspace, evaluatedAt: Date, horizonDays: number = workspace.policy.obligationHorizonDays): RunwaySeries {
  const origin = utcDay(evaluatedAt);
  const obligations = getProtectedObligations(workspace, evaluatedAt);
  const start = usdcNumber(workspace.totalTreasury);
  const buffer = usdcNumber(workspace.policy.safetyBuffer);
  let value = start;
  const points: RunwayPoint[] = [];
  for (let day = 0; day <= horizonDays; day += 1) {
    const from = origin + day * DAY_MS;
    const to = from + DAY_MS;
    // Overdue obligations are already due, so they land on day 0.
    const due = obligations.filter((item) => { const at = Date.parse(item.dueAt); return day === 0 ? at < to : at >= from && at < to; }).map((item) => ({ id: item.id, title: item.title, amount: usdcNumber(item.amount) }));
    value -= due.reduce((sum, item) => sum + item.amount, 0);
    points.push({ day, at: from, value, due });
  }
  const firstBelowBuffer = points.find((point) => point.value < buffer);
  const firstBelowZero = points.find((point) => point.value < 0);
  return { points, start, buffer, horizonDays, firstBelowBufferDay: firstBelowBuffer?.day ?? null, firstBelowZeroDay: firstBelowZero?.day ?? null };
}

export type WeekBucket = Readonly<{ start: number; total: number; count: number; titles: readonly string[] }>;

/** Protected outflows grouped by week (weeks start on Monday, UTC). Overdue obligations fall in the first week. */
export function weeklyOutflows(obligations: readonly Obligation[], from: Date, weeks = 13): WeekBucket[] {
  const day = utcDay(from);
  const monday = day - ((new Date(day).getUTCDay() + 6) % 7) * DAY_MS;
  const buckets = Array.from({ length: weeks }, (_, index) => ({ start: monday + index * 7 * DAY_MS, total: 0, count: 0, titles: [] as string[] }));
  for (const item of obligations) {
    if (item.status !== "UPCOMING" && item.status !== "OVERDUE") continue;
    const index = Math.max(0, Math.floor((Date.parse(item.dueAt) - monday) / (7 * DAY_MS)));
    if (index >= weeks) continue;
    buckets[index].total += usdcNumber(item.amount); buckets[index].count += 1; buckets[index].titles.push(item.title);
  }
  return buckets;
}

/** Ordinal blue ramp, lightest = most liquid. Validated against the dark panel surface. */
export const liquidityRamp = ["#9ec5f4", "#5598e7", "#256abf", "#184f95"] as const;
export type AllocationRow = Readonly<{ id: string; name: string; kind: StrategyKind; liquidity: StrategyPosition["liquidity"]; balance: number; share: number; color: string }>;
const liquidityOrder: Record<StrategyPosition["liquidity"], number> = { INSTANT: 0, VARIABLE: 1, RESTRICTED: 2 };

/** Where the treasury sits today, ordered from most to least liquid. Strategies with no balance are left out. */
export function allocationByLiquidity(strategies: readonly StrategyPosition[]): AllocationRow[] {
  const held = strategies.filter((strategy) => BigInt(strategy.balance.minorUnits) > 0n).sort((a, b) => liquidityOrder[a.liquidity] - liquidityOrder[b.liquidity] || a.name.localeCompare(b.name));
  const total = held.reduce((sum, strategy) => sum + usdcNumber(strategy.balance), 0);
  return held.map((strategy, index) => ({ id: strategy.id, name: strategy.name, kind: strategy.kind, liquidity: strategy.liquidity, balance: usdcNumber(strategy.balance), share: total === 0 ? 0 : usdcNumber(strategy.balance) / total, color: liquidityRamp[Math.min(index, liquidityRamp.length - 1)] }));
}

/** Position against its policy cap. The cap is a share of total treasury, matching the Earn deposit limit. */
export function capUsage(workspace: TreasuryWorkspace, strategy: StrategyPosition) {
  const capBps = workspace.policy.strategyCapsBps[strategy.kind];
  const total = usdcNumber(workspace.totalTreasury);
  const balance = usdcNumber(strategy.balance);
  const capAmount = (total * capBps) / 10_000;
  return { capBps, capAmount, balance, share: total === 0 ? 0 : balance / total, ratio: capAmount > 0 ? Math.min(balance / capAmount, 1.5) : null };
}

export function policySentences(policy: TreasuryPolicy): string[] {
  const lines = [
    `Protect obligations due in the next ${policy.obligationHorizonDays} days plus a ${formatMoney(policy.safetyBuffer)} safety buffer before any capital is deployed.`,
    `Keep safely redeemable liquidity at or above ${formatPercentFromBps(policy.minimumLiquidityCoverageBps)} of those obligations.`,
  ];
  for (const kind of ["MORPHO", "USYC", "BTC_RESERVE"] as const) {
    lines.push(policy.enabledStrategies[kind] ? `Place at most ${formatPercentFromBps(policy.strategyCapsBps[kind])} in ${strategyLabels[kind]}.` : `${strategyLabels[kind]} is not enabled; capital stays liquid.`);
  }
  lines.push("Amounts above a cap, or in a disabled strategy, stay in Liquid USDC.", "Every transaction is approved by your own wallet. Hodd never moves funds on its own.");
  return lines;
}

export type PolicyCheck = Readonly<{ status: "PASS" | "ATTENTION"; title: string; text: string }>;

export function policyChecks(workspace: TreasuryWorkspace, assessment: TreasuryAssessment): PolicyCheck[] {
  const checks: PolicyCheck[] = [];
  const floor = formatPercentFromBps(workspace.policy.minimumLiquidityCoverageBps);
  if (assessment.liquidityCoverageBps === null) checks.push({ status: "PASS", title: "Coverage", text: "No protected obligations fall inside the horizon, so coverage is not constrained." });
  else if (assessment.liquidityCoverageBps >= workspace.policy.minimumLiquidityCoverageBps) checks.push({ status: "PASS", title: "Coverage", text: `Liquidity covers obligations at ${formatPercentFromBps(assessment.liquidityCoverageBps)}, above the ${floor} floor.` });
  else checks.push({ status: "ATTENTION", title: "Coverage", text: `Liquidity covers obligations at ${formatPercentFromBps(assessment.liquidityCoverageBps)}, below the ${floor} floor.` });
  const protectedCovered = BigInt(assessment.safelyAvailableLiquidity.minorUnits) >= BigInt(assessment.protectedCapital.minorUnits);
  checks.push(protectedCovered ? { status: "PASS", title: "Protected capital", text: `Safely available liquidity (${formatMoney(assessment.safelyAvailableLiquidity)}) covers protected capital.` } : { status: "ATTENTION", title: "Protected capital", text: `Safely available liquidity (${formatMoney(assessment.safelyAvailableLiquidity)}) does not cover protected capital (${formatMoney(assessment.protectedCapital)}).` });
  for (const violation of assessment.violations) checks.push({ status: "ATTENTION", title: violation.code.replaceAll("_", " "), text: violation.message });
  return checks;
}
