import "server-only";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { treasuryWorkspaceSchema } from "@/lib/treasury/models";
import { EarnAccessError } from "./security";
import { digest } from "./digest";
import { boundUserToken, circleUserWalletClient } from "@/lib/circle/user-wallet-server";
import { Blockchain } from "@circle-fin/user-controlled-wallets";
import type { WorkspaceScope } from "@/lib/treasury/smoke-workspace";

export async function earnServerContext(scope: WorkspaceScope = "TREASURY") {
  const client = await createSupabaseServerClient();
  if (!client) throw new EarnAccessError("AUTH_REQUIRED", "Sign in before reviewing Earn operations.", 401);
  const { data, error } = await client.auth.getUser();
  const { data: sessionActive, error: sessionError } = await client.rpc("hodd_earn_session_active");
  const { data: claims } = await client.auth.getClaims();
  const sessionId = claims?.claims.session_id;
  if (error || !data.user || data.user.is_anonymous || typeof sessionId !== "string" || sessionError || sessionActive !== true) throw new EarnAccessError("AUTH_REQUIRED", "Your session expired or was revoked. Sign in again.", 401);
  const table = scope === "SMOKE_TEST" ? "earn_smoke_workspaces" : "treasury_workspaces";
  const { data: row, error: readError } = await client.from(table).select("workspace").eq("user_id", data.user.id).single();
  const parsed = treasuryWorkspaceSchema.safeParse(row?.workspace);
  if (readError || !parsed.success || parsed.data.treasuryMode !== "ARC_TESTNET_WALLET" || !parsed.data.walletConnection) throw new EarnAccessError("WORKSPACE_REQUIRED", "Sync your user-owned wallet workspace before requesting a quote.", 409);
  const workspace = parsed.data;
  const wallet = workspace.walletConnection!;
  if (scope === "SMOKE_TEST") {
    const { data: main, error: mainError } = await client.from("treasury_workspaces").select("workspace").eq("user_id", data.user.id).maybeSingle();
    if (mainError) throw new EarnAccessError("WORKSPACE_UNAVAILABLE", "The main treasury could not be checked.", 503);
    const mainWorkspace = main ? treasuryWorkspaceSchema.parse(main.workspace) : null;
    if (mainWorkspace?.treasuryMode === "ARC_TESTNET_WALLET" && mainWorkspace.walletConnection?.address.toLowerCase() === wallet.address.toLowerCase()) throw new EarnAccessError("SEPARATE_TEST_WALLET_REQUIRED", "Use a different test wallet: smoke tests must not bypass the main treasury's obligations or policy.", 409);
  }
  let userToken: string | null = null;
  if (wallet.provider === "CIRCLE_USER_CONTROLLED") {
    userToken = await boundUserToken(data.user.id);
    const circle = circleUserWalletClient();
    if (!circle || !userToken) throw new EarnAccessError("WALLET_SESSION_REQUIRED", "Reconnect the embedded wallet.", 401);
    const response = await circle.listWallets({ userToken, blockchain: Blockchain.ArcTestnet });
    if (!response.data?.wallets?.some((item) => item.id === wallet.walletId && item.address.toLowerCase() === wallet.address.toLowerCase() && item.accountType === "SCA")) throw new EarnAccessError("WALLET_MISMATCH", "The embedded wallet does not belong to this session.", 403);
  }
  return { client, table, scope, userId: data.user.id, workspace, wallet, userToken, binding: digest({ user: data.user.id, sessionId, scope, wallet }), policyDigest: digest({ policy: workspace.policy, obligations: workspace.obligations, pending: workspace.pendingTransactions }) };
}

export async function assertEarnContextCurrent(context: Awaited<ReturnType<typeof earnServerContext>>) {
  const { data, error } = await context.client.auth.getUser();
  const { data: activeSession, error: sessionError } = await context.client.rpc("hodd_earn_session_active");
  const { data: row, error: readError } = await context.client.from(context.table).select("workspace").eq("user_id", context.userId).single();
  const parsed = treasuryWorkspaceSchema.safeParse(row?.workspace);
  if (error || sessionError || activeSession !== true || data.user?.id !== context.userId || readError || !parsed.success || parsed.data.treasuryMode !== "ARC_TESTNET_WALLET" || digest(parsed.data.walletConnection) !== digest(context.wallet) || digest({ policy: parsed.data.policy, obligations: parsed.data.obligations, pending: parsed.data.pendingTransactions }) !== context.policyDigest) throw new EarnAccessError("SESSION_OR_WORKSPACE_CHANGED", "Reconnect and request a new quote after a session or workspace change.", 409);
  if (context.scope === "SMOKE_TEST") {
    const { data: row, error } = await context.client.from("treasury_workspaces").select("workspace").eq("user_id", context.userId).maybeSingle();
    if (error) throw new EarnAccessError("WORKSPACE_UNAVAILABLE", "The main treasury could not be checked.", 503);
    const main = row ? treasuryWorkspaceSchema.parse(row.workspace) : null;
    if (main?.treasuryMode === "ARC_TESTNET_WALLET" && main.walletConnection?.address.toLowerCase() === context.wallet.address.toLowerCase()) throw new EarnAccessError("SEPARATE_TEST_WALLET_REQUIRED", "The test wallet is now used by the main treasury. Execution is paused.", 409);
  }
}
