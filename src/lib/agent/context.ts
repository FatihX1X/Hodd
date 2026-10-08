import "server-only";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { treasuryWorkspaceSchema, type TreasuryWorkspace, type WalletSnapshot } from "@/lib/treasury/models";
import type { WorkspaceScope } from "@/lib/treasury/smoke-workspace";
import { applyEarnPortfolio, applyWalletSnapshot } from "@/lib/treasury/live";
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
  source: "LIVE" | "DEMO" | "PARTIAL";
  note: string;
  snapshot: WalletSnapshot | null;
  portfolio: Awaited<ReturnType<typeof getEarnPortfolio>> | null;
}>;

/**
 * Applies fresh Arc balances and Morpho positions, exactly like the browser does.
 * A demo workspace is returned as-is and clearly labelled.
 */
export async function liveWorkspace(workspace: TreasuryWorkspace, deps: { readSnapshot?: (address: string) => Promise<WalletSnapshot>; readPortfolio?: typeof getEarnPortfolio } = {}): Promise<LiveView> {
  if (workspace.treasuryMode === "LOCAL_DEMO" || !workspace.walletConnection) return { workspace, source: "DEMO", note: "No wallet is connected; these are demo balances.", snapshot: null, portfolio: null };
  const address = workspace.walletConnection.address;
  let snapshot: WalletSnapshot;
  try { snapshot = await (deps.readSnapshot ?? ((value: string) => new ViemArcTreasuryReader().readSnapshot(value)))(address); }
  catch { throw new AgentError("BALANCE_UNAVAILABLE", "Arc Testnet balances are unavailable right now, so Hodd will not calculate with stale numbers. Try again shortly."); }
  const withWallet = applyWalletSnapshot(workspace, snapshot);
  try {
    const portfolio = await (deps.readPortfolio ?? getEarnPortfolio)(address);
    const complete = portfolio.integration.positionAccess === "READY";
    return { workspace: applyEarnPortfolio(withWallet, portfolio), source: complete ? "LIVE" : "PARTIAL", note: complete ? `Live balances at Arc block ${snapshot.blockNumber}.` : "Some Morpho positions could not be read; they are excluded.", snapshot, portfolio };
  } catch {
    return { workspace: withWallet, source: "PARTIAL", note: "Morpho positions are unavailable; only the wallet's USDC is counted.", snapshot, portfolio: null };
  }
}
