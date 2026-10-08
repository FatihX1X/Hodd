import type { EarnPortfolioResponse } from "@/lib/earn/models";
import type { ActivityEntry, TreasuryWorkspace, WalletSnapshot } from "./models";
import { addMoney, moneyLike } from "./money";

// Shared by the browser workspace provider and the server-side Claude connector.

export function applyWalletSnapshot(workspace: TreasuryWorkspace, snapshot: WalletSnapshot): TreasuryWorkspace {
  const strategies = workspace.strategies.map((strategy) => strategy.kind === "LIQUID" ? { ...strategy, balance: snapshot.balance, redeemable: snapshot.balance, integration: "LIVE" as const } : strategy);
  return { ...workspace, totalTreasury: snapshot.balance, liquidUsdc: snapshot.balance, strategies };
}

type PortfolioView = Pick<EarnPortfolioResponse, "vaults" | "positions"> & { integration: { positionAccess: string } };

export function applyEarnPortfolio(workspace: TreasuryWorkspace, portfolio: PortfolioView): TreasuryWorkspace {
  const zero = moneyLike(workspace.liquidUsdc, 0n);
  const morphoBalance = addMoney(zero, ...portfolio.positions.map((position) => position.currentBalance));
  const redeemable = addMoney(zero, ...portfolio.positions.map((position) => position.liquidityStatus === "READY" ? position.redeemable : zero));
  const strategies = workspace.strategies.map((strategy) => strategy.kind === "MORPHO" ? { ...strategy, name: portfolio.vaults[0]?.name ?? strategy.name, balance: morphoBalance, redeemable, apyBps: portfolio.positions[0]?.apyBps ?? portfolio.vaults[0]?.apyBps ?? null, integration: portfolio.integration.positionAccess === "READY" ? "LIVE" as const : "UNAVAILABLE" as const } : strategy);
  return { ...workspace, totalTreasury: addMoney(workspace.liquidUsdc, morphoBalance), strategies };
}

export function makeActivity(action: string, summary: string, reason: string, occurredAt: string, actor: ActivityEntry["actor"] = "HUMAN", approval: ActivityEntry["approval"] = "NOT_REQUIRED"): ActivityEntry {
  return { id: crypto.randomUUID(), occurredAt, actor, action, summary, reason, policy: { status: "PASS", label: "Local validation", reason: "The change passed schema and deterministic policy input validation." }, approval, execution: "LOCAL_ONLY" };
}
