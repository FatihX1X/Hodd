import type { EarnPosition, EarnOperation } from "./models";
import type { Money, TreasuryWorkspace, PolicyResult } from "@/lib/treasury/models";
import { assessTreasury } from "@/lib/treasury/engine";
import { addUsdc, minUsdc } from "./money";

const money = (value: bigint): Money => ({ currency: "USDC", decimals: 6, minorUnits: (value < 0n ? 0n : value).toString() });

/** Only fresh, server-read balances enter this assessment. No client-derived limits. */
export function assessEarnOperation(workspace: TreasuryWorkspace, positions: readonly EarnPosition[], operation: EarnOperation, amount: Money, fees: Money, now = new Date()): PolicyResult {
  const values = [workspace.liquidUsdc, workspace.pendingTransactions, workspace.policy.safetyBuffer, amount, fees, ...workspace.obligations.map((item) => item.amount), ...positions.flatMap((item) => [item.currentBalance, item.redeemable])];
  addUsdc(values); // enforce a single USDC/6-decimal contract
  const blocked = (reason: string): PolicyResult => ({ status: "BLOCKED", label: "Server treasury policy", reason });
  if (positions.some((item) => item.liquidityStatus !== "READY" || now.getTime() - Date.parse(item.observedAt) > 60_000 || Date.parse(item.observedAt) > now.getTime() + 5_000)) return blocked("Fresh positions and liquidity are required.");
  if (BigInt(amount.minorUnits) <= 0n) return blocked("The amount must be greater than zero.");
  if (operation !== "DEPOSIT") return { status: "PASS", label: "Server treasury policy", reason: "Withdrawal is bounded separately by the selected fresh position, quote and vault liquidity." };
  if (!workspace.policy.enabledStrategies.MORPHO) return blocked("Morpho is disabled by this workspace policy.");
  const balance = addUsdc(positions.map((item) => item.currentBalance));
  const redeemable = addUsdc(positions.map((item) => item.redeemable));
  const live = { ...workspace, totalTreasury: addUsdc([workspace.liquidUsdc, balance]), strategies: [{ id: "live-morpho", name: "Morpho", kind: "MORPHO" as const, balance, redeemable, apyBps: null, risk: "MODERATE" as const, liquidity: "VARIABLE" as const, integration: "LIVE" as const }] };
  const assessment = assessTreasury(live, now);
  const cap = money(BigInt(live.totalTreasury.minorUnits) * BigInt(workspace.policy.strategyCapsBps.MORPHO) / 10_000n - BigInt(balance.minorUnits));
  const limit = minUsdc(assessment.deployableCapital, workspace.liquidUsdc, cap);
  const required = addUsdc([amount, fees]);
  if (BigInt(required.minorUnits) > BigInt(limit.minorUnits)) return blocked("Deposit and maximum fee reserve exceed available capital or the Morpho cap.");
  // Do not assume the new deposit will immediately be redeemable.
  const after = assessTreasury({ ...live, liquidUsdc: money(BigInt(live.liquidUsdc.minorUnits) - BigInt(required.minorUnits)), totalTreasury: money(BigInt(live.totalTreasury.minorUnits) - BigInt(fees.minorUnits)) }, now);
  if (after.violations.length) return blocked("The deposit would breach protected liquidity or minimum coverage.");
  return { status: "PASS", label: "Server treasury policy", reason: "Fresh server balances preserve obligations, safety buffer, liquidity coverage, fees and the Morpho cap." };
}
