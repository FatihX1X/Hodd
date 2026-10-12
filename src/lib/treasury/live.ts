import type { EarnPosition, EarnPortfolioResponse } from "@/lib/earn/models";
import type { ActivityEntry, TreasuryWorkspace, WalletSnapshot } from "./models";
import { addMoney, moneyLike } from "./money";

// Shared by the browser workspace provider and the server-side Claude connector.

export function applyWalletSnapshot(workspace: TreasuryWorkspace, snapshot: WalletSnapshot): TreasuryWorkspace {
  const strategies = workspace.strategies.map((strategy) => strategy.kind === "LIQUID" ? { ...strategy, balance: snapshot.balance, redeemable: snapshot.balance, observedAt: snapshot.observedAt, liquidityStatus: "READY" as const, integration: "LIVE" as const } : strategy);
  return { ...workspace, totalTreasury: snapshot.balance, liquidUsdc: snapshot.balance, strategies };
}

/** The oldest observation and weakest liquidity status govern an aggregated position. */
export function strategyObservation(positions: readonly Pick<EarnPosition, "observedAt" | "liquidityStatus">[]) {
  const observations = positions.map((position) => position.observedAt);
  const complete = positions.length > 0 && observations.every((at) => Number.isFinite(Date.parse(at)));
  return { observedAt: complete ? observations.reduce((oldest, at) => Date.parse(at) < Date.parse(oldest) ? at : oldest) : undefined,
    liquidityStatus: positions.length > 0 && positions.every((position) => position.liquidityStatus === "READY") ? "READY" as const : "UNAVAILABLE" as const };
}

type PortfolioView = Pick<EarnPortfolioResponse, "vaults" | "positions"> & { integration: { positionAccess: string }; observedAt?: string };

export function applyEarnPortfolio(workspace: TreasuryWorkspace, portfolio: PortfolioView): TreasuryWorkspace {
  const zero = moneyLike(workspace.liquidUsdc, 0n);
  const morphoBalance = addMoney(zero, ...portfolio.positions.map((position) => position.currentBalance));
  const redeemable = addMoney(zero, ...portfolio.positions.map((position) => position.liquidityStatus === "READY" ? position.redeemable : zero));
  const strategies = workspace.strategies.map((strategy) => strategy.kind === "MORPHO" ? { ...strategy, ...(portfolio.positions.length === 0 && portfolio.integration.positionAccess === "READY" && portfolio.observedAt ? { observedAt: portfolio.observedAt, liquidityStatus: "READY" as const } : strategyObservation(portfolio.positions)), name: portfolio.vaults[0]?.name ?? strategy.name, balance: morphoBalance, redeemable, apyBps: portfolio.positions[0]?.apyBps ?? portfolio.vaults[0]?.apyBps ?? null, integration: portfolio.integration.positionAccess === "READY" ? "LIVE" as const : "UNAVAILABLE" as const } : strategy);
  return { ...workspace, totalTreasury: addMoney(workspace.liquidUsdc, morphoBalance), strategies };
}

export function makeActivity(action: string, summary: string, reason: string, occurredAt: string, actor: ActivityEntry["actor"] = "HUMAN", approval: ActivityEntry["approval"] = "NOT_REQUIRED"): ActivityEntry {
  return { id: crypto.randomUUID(), occurredAt, actor, action, summary, reason, policy: { status: "PASS", label: "Local validation", reason: "The change passed schema and deterministic policy input validation." }, approval, execution: "LOCAL_ONLY" };
}
