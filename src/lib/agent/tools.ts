import { loadProtectionContext } from "@/lib/autopilot/protection-context";
import "server-only";
import { z } from "zod";
import { encodeFunctionData, erc20Abi, formatUnits, getAddress } from "viem";
import type { AuthInfo, CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { Money, TreasuryWorkspace } from "@/lib/treasury/models";
import { arcClient, discoverAllowedVaults } from "@/lib/earn/gateway";
import { boundedArcGasPrice } from "@/lib/earn/gas";
import { nativeWeiToUsdcCeil } from "@/lib/earn/money";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
import { assessTreasury } from "@/lib/treasury/engine";
import { AgentError, agentIdentity } from "./auth";
import { agentContext, liveWorkspace, type AgentContext } from "./context";
import { applyChange, AUTOPILOT_KINDS, changeSchemas, REQUEST_KINDS, type ChangeKind } from "./changes";
import { agentDb } from "@/lib/autopilot/store";
import { readUnifiedUsdc } from "@/lib/gateway/balances";
import { assertAutopilotChange, autopilotRecords, autopilotView } from "./autopilot-view";
import { confirmationKey, issueHandle, verifyHandle, HANDLE_TTL_MS } from "./handles";
import { allocationView, obligationView, overviewView, paymentCheckView, policyView, usdc } from "./views";

const scope = z.enum(["TREASURY", "SMOKE_TEST"]).default("TREASURY").describe("TREASURY (main treasury, default) or SMOKE_TEST (isolated test workspace)");
const REQUEST_TTL_MS = 24 * 3_600_000;
type Ctx = { http?: { authInfo?: AuthInfo } };

const ok = (value: unknown): CallToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const fail = (message: string): CallToolResult => ({ isError: true, content: [{ type: "text", text: message }] });

/** Every tool: user-readable errors only; never internal details. */
function guard<A>(run: (args: A, auth: AuthInfo | undefined) => Promise<unknown>) {
  return async (args: A, ctx: Ctx): Promise<CallToolResult> => {
    try { return ok(await run(args, ctx.http?.authInfo)); }
    catch (error) {
      if (error instanceof AgentError) return fail(error.message);
      if (error instanceof z.ZodError) return fail(`Invalid input: ${error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ")}`);
      if (error instanceof Error && error.name === "ChangeRejected") return fail(error.message);
      return fail("Hodd could not complete this request right now. Nothing was changed.");
    }
  };
}

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false } as const;

/** Rough USDC fee for a USDC transfer from this wallet (EOA ceiling, like Hodd's payment quote). */
export async function estimateTransferFee(workspace: TreasuryWorkspace, recipient: string | null | undefined, amount: Money): Promise<Money> {
  const zero: Money = { currency: "USDC", decimals: 6, minorUnits: "0" };
  const wallet = workspace.walletConnection;
  if (!wallet) return zero;
  let gas = 100_000n;
  if (recipient) {
    try { gas = await arcClient.estimateGas({ account: getAddress(wallet.address), to: ARC_TESTNET_USDC, data: encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(recipient), BigInt(amount.minorUnits)] }) }); }
    catch { /* keep the conservative default */ }
  }
  const price = boundedArcGasPrice(await arcClient.getGasPrice());
  return nativeWeiToUsdcCeil((gas * 2n * price).toString());
}

function rejectChange(error: unknown): never {
  const message = error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`).join("; ") : error instanceof Error ? error.message : "The change is not allowed.";
  const rejected = new Error(message); rejected.name = "ChangeRejected"; throw rejected;
}

const writeToolFor: Record<ChangeKind, string> = {
  CREATE_OBLIGATION: "hodd_create_obligation", UPDATE_OBLIGATION: "hodd_update_obligation", DELETE_OBLIGATION: "hodd_delete_obligation", UPDATE_POLICY: "hodd_update_policy",
  SET_TARGETS: "hodd_set_allocation_targets", PAYMENT_REQUEST: "hodd_request_payment", EARN_REQUEST: "hodd_request_earn",
  USYC_REQUEST: "hodd_request_usyc", AUTOPILOT_REQUEST: "hodd_request_autopilot", PAUSE_AUTOPILOT: "hodd_pause_autopilot",
};
const CHANGE_KINDS = Object.keys(changeSchemas) as [ChangeKind, ...ChangeKind[]];
const nextStep: Partial<Record<ChangeKind, string>> = {
  PAYMENT_REQUEST: "Open Hodd: the request waits under 'Agent requests' on Overview. The user reviews the fresh quote there, confirms and signs with their wallet. It expires in 24 hours.",
  EARN_REQUEST: "Open Hodd: the request waits under 'Agent requests' on Overview. The user reviews the fresh Morpho quote there, confirms and signs with their wallet. It expires in 24 hours.",
  USYC_REQUEST: "Open Hodd: the request waits under 'Agent requests' on Overview and opens the USYC pool card prefilled. The user reviews the quote and signs with their wallet. It expires in 24 hours.",
  AUTOPILOT_REQUEST: "Open Hodd: the request waits under 'Agent requests' on Overview and opens the Autopilot page prefilled. The user reviews and confirms it there (with a wallet signature where needed). It expires in 24 hours.",
  PAUSE_AUTOPILOT: "Paused. Autopilot starts no new runs until the user resumes it in Hodd (Invest). Recorded in Activity as approved in Claude.",
};

/** Autopilot belongs to the main treasury and must match the user's current Autopilot state. */
async function checkAutopilot(userId: string, workspaceScope: "TREASURY" | "SMOKE_TEST", workspace: TreasuryWorkspace, kind: ChangeKind, change: unknown) {
  if (!AUTOPILOT_KINDS.includes(kind)) return;
  if (workspaceScope !== "TREASURY") throw new AgentError("TREASURY_ONLY", "Autopilot exists only for the main treasury (scope TREASURY).");
  assertAutopilotChange(await autopilotRecords(userId), workspace, kind as "PAUSE_AUTOPILOT" | "AUTOPILOT_REQUEST", (change as { operation?: string }).operation);
}

async function prepare(auth: AuthInfo | undefined, workspaceScope: "TREASURY" | "SMOKE_TEST", kind: ChangeKind, raw: unknown) {
  let change: unknown;
  try { change = changeSchemas[kind].parse(raw); } catch (error) { rejectChange(error); }
  const context = await agentContext(auth, workspaceScope);
  const now = new Date();
  let applied;
  try { applied = applyChange(context.workspace, kind, change, now); } catch (error) { rejectChange(error); }
  await checkAutopilot(context.userId, workspaceScope, context.workspace, kind, change);
  const [live, protectionContext] = await Promise.all([liveWorkspace(context.workspace), loadProtectionContext(context.userId, context.scope)]);
  const before = assessTreasury(live.workspace, now, protectionContext);
  const afterWorkspace = applyChange(live.workspace, kind, change, now).workspace;
  const after = assessTreasury(afterWorkspace, now, protectionContext);
  const extra: Record<string, unknown> = {};
  if (kind === "PAYMENT_REQUEST") {
    const obligation = live.workspace.obligations.find((item) => item.id === (change as { obligationId: string }).obligationId)!;
    extra.paymentCheck = paymentCheckView(live.workspace, obligation, await estimateTransferFee(live.workspace, obligation.recipientAddress, obligation.amount), now, protectionContext);
  }
  const { handle } = issueHandle({ uid: context.userId, cid: context.clientId, scope: workspaceScope, kind, rev: context.revision, change }, Date.now(), await confirmationKey(context.client));
  return {
    kind, summary: applied.summary, changes: applied.lines,
    impact: { dataSource: live.source, note: live.note, deployableCapital: { before: usdc(before.deployableCapital), after: usdc(after.deployableCapital) }, protectedCapital: { before: usdc(before.protectedCapital), after: usdc(after.protectedCapital) }, coverageStatus: { before: before.coverageStatus, after: after.coverageStatus } },
    ...extra,
    approvalRequired: `Nothing has changed yet. Show this preview to the user and ask for explicit approval. Only after they approve, call ${writeToolFor[kind]} with exactly these values and the confirmation below. It expires in ${HANDLE_TTL_MS / 60_000} minutes.`,
    confirmWith: { tool: writeToolFor[kind], arguments: { ...(change as object), scope: workspaceScope, confirmation: handle } },
  };
}

async function commit(auth: AuthInfo | undefined, kind: ChangeKind, args: { scope: "TREASURY" | "SMOKE_TEST"; confirmation: string } & Record<string, unknown>) {
  const { scope: workspaceScope, confirmation, ...raw } = args;
  let change: Record<string, unknown>;
  try { change = changeSchemas[kind].parse(raw) as Record<string, unknown>; } catch (error) { rejectChange(error); }
  const identity = agentIdentity(auth);
  const context: AgentContext = await agentContext(auth, workspaceScope);
  const handle = verifyHandle(confirmation, { uid: identity.userId, cid: identity.clientId, scope: workspaceScope, kind, change }, Date.now(), await confirmationKey(context.client));
  if (handle.rev !== context.revision) throw new AgentError("WORKSPACE_CHANGED", "The workspace changed after this preview (for example in the Hodd app). Nothing was written; prepare the change again.");
  let applied;
  try { applied = applyChange(context.workspace, kind, change, new Date()); } catch (error) { rejectChange(error); }
  await checkAutopilot(context.userId, workspaceScope, context.workspace, kind, change);
  // Pausing only stops new runs, so it happens before the record: a failed record never leaves Autopilot running.
  if (kind === "PAUSE_AUTOPILOT") { const { error: pauseError } = await agentDb().rpc("hodd_pause_agent", { p_user: context.userId }); if (pauseError) throw new AgentError("WRITE_FAILED", "Hodd could not pause Autopilot right now. Nothing was changed; try again or pause it in Hodd."); }
  const isRequest = REQUEST_KINDS.includes(kind);
  const stored = kind === "EARN_REQUEST" && !change.vaultAddress ? { ...change, vaultAddress: (await discoverAllowedVaults())[0]?.address ?? null } : change;
  const { data, error } = await context.client.rpc("hodd_apply_agent_action", {
    p_id: handle.id, p_scope: workspaceScope, p_kind: kind, p_change: stored, p_summary: applied.summary.slice(0, 500),
    p_status: isRequest ? "OPEN" : "APPLIED", p_expires_at: isRequest ? new Date(Date.now() + REQUEST_TTL_MS).toISOString() : null,
    p_workspace: applied.workspace, p_revision: context.revision,
  });
  if (error) {
    if (error.code === "23505") throw new AgentError("CONFIRMATION_USED", "This confirmation was already used. Nothing new was written.");
    if (error.code === "PT409" || error.code === "40001" || error.message.includes("revision conflict")) throw new AgentError("WORKSPACE_CHANGED", "The workspace changed while saving. Nothing was written; prepare the change again.");
    if (error.message.includes("payment execution requires completion")) throw new AgentError("PAYMENT_PENDING", "A payment is pending in Hodd; finish or review it first. Nothing was written.");
    if (error.message.includes("obligation revision conflict")) throw new AgentError("WORKSPACE_CHANGED", "That obligation changed in the meantime. Prepare the change again.");
    if (error.message.includes("obligation deletion is not supported")) throw new AgentError("DELETE_REFUSED", "This bill has payment history and cannot be deleted. Keep it for the audit trail. Nothing was written.");
    throw new AgentError("WRITE_FAILED", "Hodd could not save this change. Nothing was written.");
  }
  return {
    status: isRequest ? "REQUESTED" : "APPLIED", actionId: handle.id, summary: applied.summary, changes: applied.lines, workspaceRevision: data,
    next: nextStep[kind] ?? "Saved. It is visible in Hodd and recorded in Activity as approved in Claude.",
  };
}

export function registerHoddTools(server: McpServer) {
  server.registerTool("hodd_whoami", { title: "Hodd connection status", description: "Shows which Hodd account and workspaces this Claude connection can use.", inputSchema: z.object({}), annotations: READ }, guard(async (_args: Record<string, never>, auth) => {
    const identity = agentIdentity(auth);
    const scopes: Record<string, unknown> = {};
    for (const item of ["TREASURY", "SMOKE_TEST"] as const) {
      try { const context = await agentContext(auth, item); scopes[item] = { available: true, wallet: context.workspace.walletConnection ? { provider: context.workspace.walletConnection.provider, address: context.workspace.walletConnection.address } : null, obligations: context.workspace.obligations.length }; }
      catch (error) { scopes[item] = { available: false, reason: error instanceof AgentError ? error.message : "unavailable" }; }
    }
    return { userId: identity.userId, connection: identity.clientId, workspaces: scopes, today: new Date().toISOString().slice(0, 10) };
  }));

  server.registerTool("hodd_get_overview", { title: "Treasury overview", description: "Live treasury: total, liquid USDC, Morpho positions, 30-day planning, protected obligations and effective protection lead time, protected and deployable capital, coverage and the next payment's feasibility.", inputSchema: z.object({ scope }), annotations: READ }, guard(async ({ scope: workspaceScope }: { scope: "TREASURY" | "SMOKE_TEST" }, auth) => {
    const context = await agentContext(auth, workspaceScope);
    const [live, protectionContext] = await Promise.all([liveWorkspace(context.workspace), loadProtectionContext(context.userId, context.scope)]);
    return { dataSource: live.source, note: live.note, today: new Date().toISOString().slice(0, 10), wallet: context.workspace.walletConnection ? { provider: context.workspace.walletConnection.provider, address: context.workspace.walletConnection.address } : null, ...overviewView(live.workspace, new Date(), protectionContext) };
  }));

  server.registerTool("hodd_list_obligations", { title: "List obligations", description: "Bills and obligations (payroll, rent, vendors, subscriptions, tax). Filter by status and due-date range.", inputSchema: z.object({ scope, status: z.array(z.enum(["UPCOMING", "DRAFT", "PAID", "OVERDUE"])).optional(), dueFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dueTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), annotations: READ }, guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; status?: string[]; dueFrom?: string; dueTo?: string }, auth) => {
    const context = await agentContext(auth, args.scope);
    const [live, protectionContext] = await Promise.all([liveWorkspace(context.workspace), loadProtectionContext(context.userId, context.scope)]);
    const items = context.workspace.obligations
      .filter((item) => !args.status?.length || args.status.includes(item.status))
      .filter((item) => (!args.dueFrom || item.dueAt.slice(0, 10) >= args.dueFrom) && (!args.dueTo || item.dueAt.slice(0, 10) <= args.dueTo))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    return { today: new Date().toISOString().slice(0, 10), count: items.length, obligations: items.map((item) => obligationView(live.workspace, item, new Date(), protectionContext)) };
  }));

  server.registerTool("hodd_get_obligation", { title: "Get obligation", description: "One obligation by id.", inputSchema: z.object({ scope, obligationId: z.string().min(1) }), annotations: READ }, guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; obligationId: string }, auth) => {
    const context = await agentContext(auth, args.scope);
    const item = context.workspace.obligations.find((value) => value.id === args.obligationId);
    if (!item) throw new AgentError("NOT_FOUND", "No obligation with that id. Use hodd_list_obligations.");
    const [live, protectionContext] = await Promise.all([liveWorkspace(context.workspace), loadProtectionContext(context.userId, context.scope)]);
    return obligationView(live.workspace, item, new Date(), protectionContext);
  }));

  server.registerTool("hodd_check_payment", { title: "Can I pay it?", description: "Checks with live balances and Hodd's payment policy whether an obligation (by id), or every active obligation due on or before a date, can be paid now without breaking the safety buffer or earlier bills. Includes an estimated network fee and a funding plan (how much to withdraw from Morpho first). Use for questions like 'Can I pay tomorrow's bill?'.", inputSchema: z.object({ scope, obligationId: z.string().optional(), dueOnOrBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD; checks all upcoming/overdue obligations due by then") }), annotations: READ }, guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; obligationId?: string; dueOnOrBefore?: string }, auth) => {
    if (!args.obligationId && !args.dueOnOrBefore) throw new AgentError("INVALID_INPUT", "Give an obligationId or a dueOnOrBefore date.");
    const context = await agentContext(auth, args.scope);
    const [live, protectionContext] = await Promise.all([liveWorkspace(context.workspace), loadProtectionContext(context.userId, context.scope)]);
    const targets = live.workspace.obligations
      .filter((item) => args.obligationId ? item.id === args.obligationId : ["UPCOMING", "OVERDUE"].includes(item.status) && item.dueAt.slice(0, 10) <= args.dueOnOrBefore!)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    if (!targets.length) return { dataSource: live.source, note: live.note, today: new Date().toISOString().slice(0, 10), checks: [], message: args.obligationId ? "No obligation with that id." : "No upcoming or overdue obligations are due by that date." };
    const checks = [];
    for (const item of targets) checks.push(paymentCheckView(live.workspace, item, await estimateTransferFee(live.workspace, item.recipientAddress, item.amount), new Date(), protectionContext));
    return { dataSource: live.source, note: live.note, today: new Date().toISOString().slice(0, 10), allPayableNow: checks.every((check) => check.canPayNow), checks, reminder: "Each check assumes the other listed bills are still unpaid but protected. Paying happens only in Hodd with your wallet signature." };
  }));

  server.registerTool("hodd_get_allocation_preview", { title: "Allocation preview", description: "How deployable capital would be split across strategies under the current targets and caps. Preview only.", inputSchema: z.object({ scope }), annotations: READ }, guard(async ({ scope: workspaceScope }: { scope: "TREASURY" | "SMOKE_TEST" }, auth) => {
    const context = await agentContext(auth, workspaceScope);
    const [live, protectionContext] = await Promise.all([liveWorkspace(context.workspace), loadProtectionContext(context.userId, context.scope)]);
    return { dataSource: live.source, dataNote: live.note, ...allocationView(live.workspace, new Date(), protectionContext) };
  }));

  server.registerTool("hodd_list_vaults_and_positions", { title: "Morpho vaults, USYC pool and positions", description: "Verified Morpho vaults (APY, liquidity) and this wallet's Morpho positions, plus its share of Hodd's USYC pool (value, what can be withdrawn now, deposit room, Circle status).", inputSchema: z.object({ scope }), annotations: READ }, guard(async ({ scope: workspaceScope }: { scope: "TREASURY" | "SMOKE_TEST" }, auth) => {
    const context = await agentContext(auth, workspaceScope);
    const live = await liveWorkspace(context.workspace);
    const portfolio = live.portfolio;
    const money = (minor: string) => usdc({ currency: "USDC", decimals: 6, minorUnits: minor });
    const usyc = live.usyc ? { pool: live.usyc.pool, value: money(live.usyc.valueUsdc), withdrawableNow: money(live.usyc.maxWithdrawUsdc), depositRoom: money(live.usyc.maxDepositUsdc), depositsPaused: live.usyc.depositsPaused, circleStatus: live.usyc.circle, priceUsdcPerUsyc: Number(formatUnits(BigInt(live.usyc.priceUsdcPerUsyc), 18)).toFixed(4), observedAt: live.usyc.observedAt, note: "Users hold USDC value in Hodd's pool; the pool holds the USYC. Withdrawals always go back to the same wallet as USDC." } : null;
    return { dataSource: live.source, note: live.note, vaults: (portfolio?.vaults ?? []).map((vault) => ({ address: vault.address, name: vault.name, apy: vault.apyBps === null ? null : `${(vault.apyBps / 100).toFixed(2)}%`, liquidity: usdc(vault.liquidity), status: vault.status })), positions: (portfolio?.positions ?? []).map((position) => ({ vaultAddress: position.vaultAddress, vaultName: position.vaultName, balance: usdc(position.currentBalance), redeemable: usdc(position.redeemable), shares: position.shares, status: position.liquidityStatus })), usyc };
  }));

  server.registerTool("hodd_get_autopilot", { title: "Autopilot status", description: "The user's Autopilot (main treasury only): whether it is active or paused, its vault and agent wallet, vault balances in cash/Morpho/USYC with APYs, which bills it will pay on their payment day and which need approval, what needs the user, and the latest runs with their decisions.", inputSchema: z.object({}), annotations: READ }, guard(async (_args: Record<string, never>, auth) => {
    const context = await agentContext(auth, "TREASURY");
    return { today: new Date().toISOString().slice(0, 10), ...(await autopilotView(context.userId, context.workspace)) };
  }));

  server.registerTool("hodd_get_unified_balance", { title: "Cross-chain USDC (Circle Gateway)", description: "USDC for the connected wallet on every Circle Gateway testnet: in the wallet on each chain and already in Gateway (spendable on Arc in seconds). Read-only; moving it happens in Hodd with the user's wallet.", inputSchema: z.object({ scope }), annotations: READ }, guard(async ({ scope: workspaceScope }: { scope: "TREASURY" | "SMOKE_TEST" }, auth) => {
    const context = await agentContext(auth, workspaceScope);
    const wallet = context.workspace.walletConnection;
    if (!wallet) return { dataSource: "NOT_CONNECTED", note: "No wallet is connected in Hodd. Connect one at app.hoddfinance.xyz first.", chains: [] };
    let view;
    try { view = await readUnifiedUsdc(wallet.address); } catch { throw new AgentError("UNIFIED_BALANCE_UNAVAILABLE", "Cross-chain balances could not be read right now."); }
    const show = (value: { minorUnits: string } | null) => value === null ? null : usdc({ currency: "USDC", decimals: 6, minorUnits: value.minorUnits });
    return { address: view.address, observedAt: view.observedAt, gatewayStatus: view.gatewayStatus, unavailableChains: view.unavailableChains, totals: { inWallets: show(view.totals.wallet), inGateway: show(view.totals.gateway), all: show(view.totals.all), inWalletsOffArc: show(view.totals.offArcWallet) }, chains: view.chains.map((chain) => ({ chain: chain.label, inWallet: show(chain.wallet), inGateway: show(chain.gateway), depositWait: chain.depositWait })), next: "To use USDC from another chain, the user moves it to Arc on Hodd's Overview (Unified balance) with their own wallet." };
  }));

  server.registerTool("hodd_get_policy", { title: "Treasury policy", description: "Safety buffer, minimum liquidity coverage, protection window (lead days), strategy caps, enabled strategies and target allocations.", inputSchema: z.object({ scope }), annotations: READ }, guard(async ({ scope: workspaceScope }: { scope: "TREASURY" | "SMOKE_TEST" }, auth) => { const context = await agentContext(auth, workspaceScope); return policyView(context.workspace, await loadProtectionContext(context.userId, context.scope)); }));

  server.registerTool("hodd_list_activity", { title: "Activity log", description: "Recent treasury activity: who did what (you, the system, or Claude), with approval and policy results.", inputSchema: z.object({ scope, limit: z.number().int().min(1).max(100).default(20), actor: z.enum(["HUMAN", "AGENT", "SYSTEM"]).optional() }), annotations: READ }, guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; limit: number; actor?: string }, auth) => {
    const context = await agentContext(auth, args.scope);
    return { activities: context.workspace.activities.filter((item) => !args.actor || item.actor === args.actor).slice(0, args.limit).map((item) => ({ at: item.occurredAt, actor: item.actor, action: item.action, summary: item.summary, reason: item.reason, approval: item.approval, execution: item.execution, transactionHash: item.transactionHash ?? null })) };
  }));

  server.registerTool("hodd_list_payments", { title: "Payment history", description: "Payment proposals and their states (review, signing, submitted, confirmed, failed) with transaction hashes.", inputSchema: z.object({ scope, limit: z.number().int().min(1).max(50).default(20) }), annotations: READ }, guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; limit: number }, auth) => {
    const context = await agentContext(auth, args.scope);
    const { data, error } = await context.client.from("payment_proposals").select("id,state,proposal,tx_hash,updated_at").eq("user_id", context.userId).eq("scope", args.scope).order("updated_at", { ascending: false }).limit(args.limit);
    if (error) throw new AgentError("UNAVAILABLE", "Payment history is unavailable right now.");
    return { payments: (data ?? []).map((row) => { const proposal = row.proposal as { obligationId?: string; recipientAddress?: string; amount?: Money; recipientLabel?: string | null }; return { id: row.id, state: row.state, obligationId: proposal.obligationId ?? null, recipient: proposal.recipientLabel ?? proposal.recipientAddress ?? null, amount: proposal.amount ? usdc(proposal.amount) : null, transactionHash: row.tx_hash, updatedAt: row.updated_at }; }) };
  }));

  server.registerTool("hodd_list_requests", { title: "Claude requests and changes", description: "Changes applied through Claude and requests (payment, Morpho, USYC, Autopilot) waiting for the user in Hodd (OPEN, DONE, DISMISSED).", inputSchema: z.object({ scope, status: z.enum(["APPLIED", "OPEN", "DONE", "DISMISSED"]).optional(), limit: z.number().int().min(1).max(50).default(20) }), annotations: READ }, guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; status?: string; limit: number }, auth) => {
    const context = await agentContext(auth, args.scope);
    let query = context.client.from("agent_actions").select("id,kind,summary,status,created_at,expires_at,resolved_at").eq("user_id", context.userId).eq("scope", args.scope).order("created_at", { ascending: false }).limit(args.limit);
    if (args.status) query = query.eq("status", args.status);
    const { data, error } = await query;
    if (error) throw new AgentError("UNAVAILABLE", "Requests are unavailable right now.");
    const now = Date.now();
    return { requests: (data ?? []).map((row) => ({ ...row, expired: row.status === "OPEN" && row.expires_at !== null && Date.parse(row.expires_at) <= now })) };
  }));

  server.registerTool("hodd_prepare_change", {
    title: "Preview a change (no effect)",
    description: `Step 1 of every change. Validates a change against live data and Hodd's rules and returns a human-readable preview plus a confirmation handle. Changes nothing. Kinds: ${CHANGE_KINDS.join(", ")} (fields: see the matching write tool: ${CHANGE_KINDS.map((kind) => `${kind} → ${writeToolFor[kind]}`).join(", ")}). After showing the preview, get the user's explicit approval before calling the write tool named in confirmWith.`,
    inputSchema: z.object({ scope, kind: z.enum(CHANGE_KINDS), change: z.record(z.string(), z.unknown()).describe("Fields for the chosen kind, exactly as the matching write tool accepts them (without scope/confirmation)") }),
    annotations: READ,
  }, guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; kind: ChangeKind; change: Record<string, unknown> }, auth) => prepare(auth, args.scope, args.kind, args.change)));

  const confirmation = z.string().min(20).describe("The confirmation handle returned by hodd_prepare_change for exactly these values");
  const writeTool = (name: string, kind: ChangeKind, title: string, description: string) => {
    const schema = changeSchemas[kind];
    server.registerTool(name, { title, description: `${description} Requires a confirmation from hodd_prepare_change with identical values; only call after the user explicitly approved the preview.`, inputSchema: z.object({ ...schema.shape, scope, confirmation }).strict(), annotations: WRITE },
      guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; confirmation: string } & Record<string, unknown>, auth) => commit(auth, kind, args)));
  };
  writeTool("hodd_create_obligation", "CREATE_OBLIGATION", "Create obligation", "Adds a bill/obligation to the treasury.");
  writeTool("hodd_update_obligation", "UPDATE_OBLIGATION", "Update obligation", "Edits an obligation (amount, date, status DRAFT/UPCOMING/OVERDUE, recipient…). Paid obligations and deletion are not allowed.");
  writeTool("hodd_delete_obligation", "DELETE_OBLIGATION", "Delete obligation", "Deletes a bill that has no payment history (not paid, no pending payment or payment reference). Activity keeps a record.");
  writeTool("hodd_update_policy", "UPDATE_POLICY", "Update treasury policy", "Changes safety buffer, minimum coverage, protection window (lead days), strategy caps or enabled strategies.");
  writeTool("hodd_set_allocation_targets", "SET_TARGETS", "Set allocation targets", "Sets target allocation percentages (basis points totalling 10000). Affects previews only.");
  writeTool("hodd_request_payment", "PAYMENT_REQUEST", "Request a payment", "Creates a payment request for an obligation. It does not move money: the user completes it in Hodd by confirming and signing with their own wallet.");
  writeTool("hodd_request_earn", "EARN_REQUEST", "Request a Morpho deposit/withdrawal", "Creates a Morpho deposit, withdrawal or redeem-all request. It does not move money: the user completes it in Hodd with a fresh quote and their wallet signature.");
  writeTool("hodd_request_usyc", "USYC_REQUEST", "Request a USYC pool deposit/withdrawal", "Creates a deposit, withdrawal or withdraw-all request for Hodd's USYC pool (USDC in, USDC out). It does not move money: the user completes it in Hodd with a fresh quote and their wallet signature.");
  writeTool("hodd_request_autopilot", "AUTOPILOT_REQUEST", "Request an Autopilot action", "Creates an Autopilot request (invest, approve a bill for the vault, return everything, withdraw all from the vault, lift old vault limits). Main treasury only. It does nothing by itself: the user confirms it on Hodd's Autopilot page, with a wallet signature where needed.");
  writeTool("hodd_pause_autopilot", "PAUSE_AUTOPILOT", "Pause Autopilot", "Pauses Autopilot right away: it starts no new runs (already submitted transactions can still settle). Main treasury only. Resuming happens in Hodd.");

  server.registerTool("hodd_dismiss_request", { title: "Dismiss a request", description: "Cancels an open request created through Claude (payment, Morpho, USYC or Autopilot).", inputSchema: z.object({ scope, requestId: z.string().uuid() }), annotations: WRITE }, guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; requestId: string }, auth) => {
    const context = await agentContext(auth, args.scope);
    const { error } = await context.client.rpc("hodd_resolve_agent_request", { p_id: args.requestId, p_status: "DISMISSED" });
    if (error) throw new AgentError("NOT_OPEN", "That request is not open (already done, dismissed or not yours).");
    return { status: "DISMISSED", requestId: args.requestId };
  }));
}

export const HODD_INSTRUCTIONS = [
  "Hodd is a liability-aware treasury on Arc Testnet (USDC). Read tools are safe to call anytime.",
  "Every change is two steps: call hodd_prepare_change, show the user the returned summary and changes, and ask for explicit approval in the chat. Only after the user approves, call the write tool named in confirmWith with exactly the same values and the confirmation handle.",
  "Never invent a confirmation and never call a write tool the user has not approved. If a write fails because the workspace changed, prepare again and ask again.",
  "Money never moves from Claude: hodd_request_payment, hodd_request_earn, hodd_request_usyc and hodd_request_autopilot only create requests; the user finishes them in Hodd with their own wallet signature. hodd_pause_autopilot stops Autopilot (after approval) and never moves money.",
  "Use hodd_get_autopilot for Autopilot questions, hodd_list_vaults_and_positions for Morpho and the USYC pool, and hodd_get_unified_balance for USDC on other chains.",
  "Use hodd_check_payment for questions like 'Can I pay tomorrow's bill?'. Dates are YYYY-MM-DD; get today's date from hodd_whoami or hodd_get_overview.",
].join(" ");
