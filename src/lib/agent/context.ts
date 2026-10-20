import "server-only";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { treasuryWorkspaceSchema, type TreasuryWorkspace, type WalletSnapshot } from "@/lib/treasury/models";
import type { WorkspaceScope } from "@/lib/treasury/smoke-workspace";
import { applyEarnPortfolio, applyUsycPosition, applyWalletSnapshot } from "@/lib/treasury/live";
import { readUsycStatus } from "@/lib/usyc/status";
import type { UsycPosition } from "@/lib/usyc/models";
import { ViemArcTreasuryReader } from "@/lib/arc/reader";
import { getEarnPortfolio } from "@/lib/earn/gateway";
import { AgentError, agentIdentity, agentSupabase, assertAgentSessionActive } from "./auth";

export const tableFor = (scope: WorkspaceScope) => scope === "SMOKE_TEST" ? "earn_smoke_workspaces" : "treasury_workspaces";

/** The signed-in user's workspace, read through owner RLS with the connector token. */
export async function agentContext(authInfo: AuthInfo | undefined, scope: WorkspaceScope) {
  const identity = agentIdentity(authInfo);
  const token = authInfo!.token;
  await assertAgentSessionActive(token);
  const client = agentSupabase(token);
  const { data, error } = await client.from(tableFor(scope)).select("workspace, revision").eq("user_id", identity.userId).maybeSingle();
  if (error) throw new AgentError("WORKSPACE_UNAVAILABLE", "Hodd could not read your workspace right now.");
  if (!data) throw new AgentError("WORKSPACE_REQUIRED", scope === "SMOKE_TEST" ? "You have no smoke-test workspace yet. Open it once in Hodd." : "You have no Hodd workspace yet. Sign in to Hodd once in the browser to create it.");
  const parsed = treasuryWorkspaceSchema.safeParse(data.workspace);
  if (!parsed.success) throw new AgentError("WORKSPACE_INVALID", "Your saved workspace failed validation. Open Hodd in the browser to repair it.");
  return { ...identity, client, scope, workspace: parsed.data, revision: Number(data.revision) };
}
export type AgentContext = Awaited<ReturnType<typeof agentContext>>;

export type LiveView = Readonly<{
  workspace: TreasuryWorkspace;
  source: "LIVE" | "NOT_CONNECTED" | "PARTIAL";
  note: string;
  snapshot: WalletSnapshot | null;
  portfolio: Awaited<ReturnType<typeof getEarnPortfolio>> | null;
  /** The wallet's share of Hodd's USYC pool; null without a wallet, an undeployed pool or a failed read. */
  usyc: UsycPosition | null;
}>;

/**
 * Applies fresh Arc balances, Morpho positions and the USYC pool position, exactly like the browser does.
 * Without a wallet nothing is live: balances are reported as zero, never as stored numbers.
 */
export async function liveWorkspace(workspace: TreasuryWorkspace, deps: { readSnapshot?: (address: string) => Promise<WalletSnapshot>; readPortfolio?: typeof getEarnPortfolio; readUsyc?: (address: string) => Promise<UsycPosition | null> } = {}): Promise<LiveView> {
  if (workspace.treasuryMode === "LOCAL_DEMO" || !workspace.walletConnection) {
    const zero = { ...workspace.liquidUsdc, minorUnits: "0" };
    return { workspace: { ...workspace, totalTreasury: zero, liquidUsdc: zero, pendingTransactions: zero, strategies: workspace.strategies.map((strategy) => ({ ...strategy, balance: zero, redeemable: zero, apyBps: null, integration: "UNAVAILABLE" as const })) }, source: "NOT_CONNECTED", note: "No wallet is connected in Hodd, so there are no live balances. Connect a wallet at app.hoddfinance.xyz first.", snapshot: null, portfolio: null, usyc: null };
  }
  const address = workspace.walletConnection.address;
  let snapshot: WalletSnapshot;
  try { snapshot = await (deps.readSnapshot ?? ((value: string) => new ViemArcTreasuryReader().readSnapshot(value)))(address); }
  catch { throw new AgentError("BALANCE_UNAVAILABLE", "Arc Testnet balances are unavailable right now, so Hodd will not calculate with stale numbers. Try again shortly."); }
  const zero = { ...workspace.liquidUsdc, minorUnits: "0" };
  const withWallet = applyWalletSnapshot({ ...workspace, strategies: workspace.strategies.map((strategy) => ({ ...strategy, balance: zero, redeemable: zero, apyBps: null, integration: "UNAVAILABLE" })) }, snapshot);
  const [earn, pool] = await Promise.all([
    (deps.readPortfolio ?? getEarnPortfolio)(address).then((value) => ({ ok: true as const, value }), () => ({ ok: false as const })),
    (deps.readUsyc ?? ((value: string) => readUsycStatus(value)))(address).then((value) => ({ ok: true as const, value }), () => ({ ok: false as const })),
  ]);
  const portfolio = earn.ok ? earn.value : null;
  // Only a fresh read for exactly this wallet counts, as in the browser.
  const usyc = pool.ok && pool.value && pool.value.wallet.toLowerCase() === address.toLowerCase() ? pool.value : null;
  const withEarn = portfolio ? applyEarnPortfolio(withWallet, portfolio) : withWallet;
  const live = usyc ? applyUsycPosition(withEarn, usyc) : withEarn;
  const gaps = [!portfolio ? "Morpho positions are unavailable and excluded." : portfolio.integration.positionAccess !== "READY" ? "Some Morpho positions could not be read; they are excluded." : null, !pool.ok ? "The USYC pool position is unavailable and excluded." : null].filter(Boolean);
  return { workspace: live, source: gaps.length ? "PARTIAL" : "LIVE", note: gaps.length ? gaps.join(" ") : `Live balances at Arc block ${snapshot.blockNumber}.`, snapshot, portfolio, usyc };
}
