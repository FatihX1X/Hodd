import type { EarnPosition, EarnPortfolioResponse } from "@/lib/earn/models";
import type { UsycPosition } from "@/lib/usyc/models";
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
  // A USYC position read earlier in the same chain stays part of the total, whatever order the reads are applied in.
  const usycHeld = workspace.strategies.filter((strategy) => strategy.kind === "USYC" && strategy.integration === "LIVE").map((strategy) => strategy.balance);
  return { ...workspace, totalTreasury: addMoney(workspace.liquidUsdc, morphoBalance, ...usycHeld), strategies };
}

/** The strategy name for USYC: users reach it through Hodd's pool, depositing and withdrawing USDC only. */
export const USYC_STRATEGY_NAME = "USYC · via Hodd's pool";

/** What a withdrawal could pay now: the position's value, capped by what the pool can pay out (Circle's daily limit, fund liquidity). */
export function usycRedeemableMinor(position: Pick<UsycPosition, "valueUsdc" | "maxWithdrawUsdc">): bigint {
  const value = BigInt(position.valueUsdc), most = BigInt(position.maxWithdrawUsdc);
  return most < value ? most : value;
}

/**
 * The connected wallet's share of Hodd's USYC pool, read fresh, as a live position: balance is its USDC value, redeemable
 * is what a withdrawal could pay now, and it only counts as ready liquidity while Circle permits the pool and USYC is
 * not paused. Only the wallet can withdraw it, always to itself. Included in the treasury total like Morpho.
 */
export function applyUsycPosition(workspace: TreasuryWorkspace, position: UsycPosition): TreasuryWorkspace {
  const zero = moneyLike(workspace.liquidUsdc, 0n);
  const balance = moneyLike(zero, BigInt(position.valueUsdc));
  const redeemable = moneyLike(zero, usycRedeemableMinor(position));
  const ready = position.circle === "OK";
  const strategies = workspace.strategies.map((strategy) => strategy.kind === "USYC" ? { ...strategy, name: USYC_STRATEGY_NAME, balance, redeemable, apyBps: null, observedAt: position.observedAt, liquidityStatus: ready ? "READY" as const : "UNAVAILABLE" as const, integration: "LIVE" as const } : strategy);
  const others = strategies.filter((strategy) => strategy.kind !== "LIQUID" && strategy.kind !== "USYC").map((strategy) => strategy.balance);
  return { ...workspace, totalTreasury: addMoney(workspace.liquidUsdc, ...others, balance), strategies };
}

export function makeActivity(action: string, summary: string, reason: string, occurredAt: string, actor: ActivityEntry["actor"] = "HUMAN", approval: ActivityEntry["approval"] = "NOT_REQUIRED"): ActivityEntry {
  return { id: crypto.randomUUID(), occurredAt, actor, action, summary, reason, policy: { status: "PASS", label: "Local validation", reason: "The change passed schema and deterministic policy input validation." }, approval, execution: "LOCAL_ONLY" };
}
