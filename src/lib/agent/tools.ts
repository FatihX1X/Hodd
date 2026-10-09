import "server-only";
import { z } from "zod";
import { encodeFunctionData, erc20Abi, getAddress } from "viem";
import type { AuthInfo, CallToolResult, McpServer } from "@modelcontextprotocol/server";
import type { Money, TreasuryWorkspace } from "@/lib/treasury/models";
import { arcClient, discoverAllowedVaults } from "@/lib/earn/gateway";
import { boundedArcGasPrice } from "@/lib/earn/gas";
import { nativeWeiToUsdcCeil } from "@/lib/earn/money";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
import { assessTreasury } from "@/lib/treasury/engine";
import { AgentError, agentIdentity } from "./auth";
import { agentContext, liveWorkspace, type AgentContext } from "./context";
import { applyChange, changeSchemas, REQUEST_KINDS, type ChangeKind } from "./changes";
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
  CREATE_OBLIGATION: "hodd_create_obligation", UPDATE_OBLIGATION: "hodd_update_obligation", UPDATE_POLICY: "hodd_update_policy",
  SET_TARGETS: "hodd_set_allocation_targets", PAYMENT_REQUEST: "hodd_request_payment", EARN_REQUEST: "hodd_request_earn",
};

async function prepare(auth: AuthInfo | undefined, workspaceScope: "TREASURY" | "SMOKE_TEST", kind: ChangeKind, raw: unknown) {
  let change: unknown;
  try { change = changeSchemas[kind].parse(raw); } catch (error) { rejectChange(error); }
  const context = await agentContext(auth, workspaceScope);
  const now = new Date();
  let applied;
  try { applied = applyChange(context.workspace, kind, change, now); } catch (error) { rejectChange(error); }
  const live = await liveWorkspace(context.workspace);
  const before = assessTreasury(live.workspace, now);
  const afterWorkspace = applyChange(live.workspace, kind, change, now).workspace;
  const after = assessTreasury(afterWorkspace, now);
  const extra: Record<string, unknown> = {};
  if (kind === "PAYMENT_REQUEST") {
    const obligation = live.workspace.obligations.find((item) => item.id === (change as { obligationId: string }).obligationId)!;
    extra.paymentCheck = paymentCheckView(live.workspace, obligation, await estimateTransferFee(live.workspace, obligation.recipientAddress, obligation.amount), now);
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
  const isRequest = REQUEST_KINDS.includes(kind);
  const stored = kind === "EARN_REQUEST" && !change.vaultAddress ? { ...change, vaultAddress: (await discoverAllowedVaults())[0]?.address ?? null } : change;
  const { data, error } = await context.client.rpc("hodd_apply_agent_action", {
    p_id: handle.id, p_scope: workspaceScope, p_kind: kind, p_change: stored, p_summary: applied.summary.slice(0, 500),
    p_status: isRequest ? "OPEN" : "APPLIED", p_expires_at: isRequest ? new Date(Date.now() + REQUEST_TTL_MS).toISOString() : null,
    p_workspace: applied.workspace, p_revision: context.revision,
  });
  if (error) {
    if (error.code === "23505") throw new AgentError("CONFIRMATION_USED", "This confirmation was already used. Nothing new was written.");
    if (error.code === "40001" || error.message.includes("revision conflict")) throw new AgentError("WORKSPACE_CHANGED", "The workspace changed while saving. Nothing was written; prepare the change again.");
    if (error.message.includes("payment execution requires completion")) throw new AgentError("PAYMENT_PENDING", "A payment is pending in Hodd; finish or review it first. Nothing was written.");
    if (error.message.includes("obligation revision conflict")) throw new AgentError("WORKSPACE_CHANGED", "That obligation changed in the meantime. Prepare the change again.");
    throw new AgentError("WRITE_FAILED", "Hodd could not save this change. Nothing was written.");
  }
  return {
    status: isRequest ? "REQUESTED" : "APPLIED", actionId: handle.id, summary: applied.summary, changes: applied.lines, workspaceRevision: data,
    next: isRequest ? "Open Hodd: the request is waiting under 'Claude requests'. The user reviews the fresh quote there, confirms and signs with their wallet. It expires in 24 hours." : "Saved. It is visible in Hodd and recorded in Activity as approved in Claude.",
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

  server.registerTool("hodd_get_overview", { title: "Treasury overview", description: "Live treasury: total, liquid USDC, Morpho positions, upcoming 30-day obligations, protected and deployable capital, coverage and the next payment's feasibility.", inputSchema: z.object({ scope }), annotations: READ }, guard(async ({ scope: workspaceScope }: { scope: "TREASURY" | "SMOKE_TEST" }, auth) => {
    const context = await agentContext(auth, workspaceScope);
    const live = await liveWorkspace(context.workspace);
    return { dataSource: live.source, note: live.note, today: new Date().toISOString().slice(0, 10), wallet: context.workspace.walletConnection ? { provider: context.workspace.walletConnection.provider, address: context.workspace.walletConnection.address } : null, ...overviewView(live.workspace) };
  }));

  server.registerTool("hodd_list_obligations", { title: "List obligations", description: "Bills and obligations (payroll, rent, vendors, subscriptions, tax). Filter by status and due-date range.", inputSchema: z.object({ scope, status: z.array(z.enum(["UPCOMING", "DRAFT", "PAID", "OVERDUE"])).optional(), dueFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), dueTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }), annotations: READ }, guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; status?: string[]; dueFrom?: string; dueTo?: string }, auth) => {
    const context = await agentContext(auth, args.scope);
    const items = context.workspace.obligations
      .filter((item) => !args.status?.length || args.status.includes(item.status))
      .filter((item) => (!args.dueFrom || item.dueAt.slice(0, 10) >= args.dueFrom) && (!args.dueTo || item.dueAt.slice(0, 10) <= args.dueTo))
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    return { today: new Date().toISOString().slice(0, 10), count: items.length, obligations: items.map((item) => obligationView(context.workspace, item)) };
  }));

  server.registerTool("hodd_get_obligation", { title: "Get obligation", description: "One obligation by id.", inputSchema: z.object({ scope, obligationId: z.string().min(1) }), annotations: READ }, guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; obligationId: string }, auth) => {
    const context = await agentContext(auth, args.scope);
    const item = context.workspace.obligations.find((value) => value.id === args.obligationId);
    if (!item) throw new AgentError("NOT_FOUND", "No obligation with that id. Use hodd_list_obligations.");
    return obligationView(context.workspace, item);
  }));

  server.registerTool("hodd_check_payment", { title: "Can I pay it?", description: "Checks with live balances and Hodd's payment policy whether an obligation (by id), or every active obligation due on or before a date, can be paid now without breaking the safety buffer or earlier bills. Includes an estimated network fee and a funding plan (how much to withdraw from Morpho first). Use for questions like 'Can I pay tomorrow's bill?'.", inputSchema: z.object({ scope, obligationId: z.string().optional(), dueOnOrBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe("YYYY-MM-DD; checks all upcoming/overdue obligations due by then") }), annotations: READ }, guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; obligationId?: string; dueOnOrBefore?: string }, auth) => {
    if (!args.obligationId && !args.dueOnOrBefore) throw new AgentError("INVALID_INPUT", "Give an obligationId or a dueOnOrBefore date.");
    const context = await agentContext(auth, args.scope);
    const live = await liveWorkspace(context.workspace);
    const targets = live.workspace.obligations
      .filter((item) => args.obligationId ? item.id === args.obligationId : ["UPCOMING", "OVERDUE"].includes(item.status) && item.dueAt.slice(0, 10) <= args.dueOnOrBefore!)
      .sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    if (!targets.length) return { dataSource: live.source, note: live.note, today: new Date().toISOString().slice(0, 10), checks: [], message: args.obligationId ? "No obligation with that id." : "No upcoming or overdue obligations are due by that date." };
    const checks = [];
    for (const item of targets) checks.push(paymentCheckView(live.workspace, item, await estimateTransferFee(live.workspace, item.recipientAddress, item.amount)));
    return { dataSource: live.source, note: live.note, today: new Date().toISOString().slice(0, 10), allPayableNow: checks.every((check) => check.canPayNow), checks, reminder: "Each check assumes the other listed bills are still unpaid but protected. Paying happens only in Hodd with your wallet signature." };
  }));

  server.registerTool("hodd_get_allocation_preview", { title: "Allocation preview", description: "How deployable capital would be split across strategies under the current targets and caps. Preview only.", inputSchema: z.object({ scope }), annotations: READ }, guard(async ({ scope: workspaceScope }: { scope: "TREASURY" | "SMOKE_TEST" }, auth) => {
    const context = await agentContext(auth, workspaceScope);
    const live = await liveWorkspace(context.workspace);
    return { dataSource: live.source, dataNote: live.note, ...allocationView(live.workspace) };
  }));

  server.registerTool("hodd_list_vaults_and_positions", { title: "Morpho vaults and positions", description: "Verified Morpho vaults (APY, liquidity) and this wallet's positions with redeemable amounts.", inputSchema: z.object({ scope }), annotations: READ }, guard(async ({ scope: workspaceScope }: { scope: "TREASURY" | "SMOKE_TEST" }, auth) => {
    const context = await agentContext(auth, workspaceScope);
    const live = await liveWorkspace(context.workspace);
    const portfolio = live.portfolio;
    if (!portfolio) return { dataSource: live.source, note: live.note, vaults: [], positions: [] };
    return { dataSource: live.source, note: live.note, vaults: portfolio.vaults.map((vault) => ({ address: vault.address, name: vault.name, apy: vault.apyBps === null ? null : `${(vault.apyBps / 100).toFixed(2)}%`, liquidity: usdc(vault.liquidity), status: vault.status })), positions: portfolio.positions.map((position) => ({ vaultAddress: position.vaultAddress, vaultName: position.vaultName, balance: usdc(position.currentBalance), redeemable: usdc(position.redeemable), shares: position.shares, status: position.liquidityStatus })) };
  }));

  server.registerTool("hodd_get_policy", { title: "Treasury policy", description: "Safety buffer, minimum liquidity coverage, strategy caps, enabled strategies and target allocations.", inputSchema: z.object({ scope }), annotations: READ }, guard(async ({ scope: workspaceScope }: { scope: "TREASURY" | "SMOKE_TEST" }, auth) => policyView((await agentContext(auth, workspaceScope)).workspace)));

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

  server.registerTool("hodd_list_requests", { title: "Claude requests and changes", description: "Changes applied through Claude and money requests waiting for the user in Hodd (OPEN, DONE, DISMISSED).", inputSchema: z.object({ scope, status: z.enum(["APPLIED", "OPEN", "DONE", "DISMISSED"]).optional(), limit: z.number().int().min(1).max(50).default(20) }), annotations: READ }, guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; status?: string; limit: number }, auth) => {
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
    description: "Step 1 of every change. Validates a change against live data and Hodd's rules and returns a human-readable preview plus a confirmation handle. Changes nothing. Kinds: CREATE_OBLIGATION, UPDATE_OBLIGATION, UPDATE_POLICY, SET_TARGETS, PAYMENT_REQUEST, EARN_REQUEST. After showing the preview, get the user's explicit approval before calling the write tool named in confirmWith.",
    inputSchema: z.object({ scope, kind: z.enum(["CREATE_OBLIGATION", "UPDATE_OBLIGATION", "UPDATE_POLICY", "SET_TARGETS", "PAYMENT_REQUEST", "EARN_REQUEST"]), change: z.record(z.string(), z.unknown()).describe("Fields for the chosen kind, exactly as the matching write tool accepts them (without scope/confirmation)") }),
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
  writeTool("hodd_update_policy", "UPDATE_POLICY", "Update treasury policy", "Changes safety buffer, minimum coverage, strategy caps or enabled strategies.");
  writeTool("hodd_set_allocation_targets", "SET_TARGETS", "Set allocation targets", "Sets target allocation percentages (basis points totalling 10000). Affects previews only.");
  writeTool("hodd_request_payment", "PAYMENT_REQUEST", "Request a payment", "Creates a payment request for an obligation. It does not move money: the user completes it in Hodd by confirming and signing with their own wallet.");
  writeTool("hodd_request_earn", "EARN_REQUEST", "Request a Morpho deposit/withdrawal", "Creates a Morpho deposit, withdrawal or redeem-all request. It does not move money: the user completes it in Hodd with a fresh quote and their wallet signature.");

  server.registerTool("hodd_dismiss_request", { title: "Dismiss a request", description: "Cancels an open payment or Earn request created through Claude.", inputSchema: z.object({ scope, requestId: z.string().uuid() }), annotations: WRITE }, guard(async (args: { scope: "TREASURY" | "SMOKE_TEST"; requestId: string }, auth) => {
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
  "Money never moves from Claude: hodd_request_payment and hodd_request_earn only create requests; the user finishes them in Hodd with their own wallet signature.",
  "Use hodd_check_payment for questions like 'Can I pay tomorrow's bill?'. Dates are YYYY-MM-DD; get today's date from hodd_whoami or hodd_get_overview.",
].join(" ");
