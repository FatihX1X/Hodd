// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "@/test/fixtures";

const fake = vi.hoisted(() => ({ rpc: vi.fn(), adminRpc: vi.fn(), revision: 5, wallet: null as null | Record<string, unknown>, mandate: null as null | Record<string, unknown> }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/agent/auth", async (original) => {
  const actual = await original<typeof import("@/lib/agent/auth")>();
  return { ...actual, verifyAgentToken: vi.fn(async (token?: string) => token === "good" ? { token, clientId: "claude", scopes: [], extra: { identity: { userId: "user-1", clientId: "claude", sessionId: null } } } : undefined), supabaseIssuer: () => "https://example.supabase.co/auth/v1" };
});
vi.mock("@/lib/agent/context", () => ({
  tableFor: () => "treasury_workspaces",
  agentContext: vi.fn(async () => ({ userId: "user-1", clientId: "claude", sessionId: null, scope: "TREASURY", revision: fake.revision, workspace: structuredClone(initialWorkspace), client: { rpc: fake.rpc } })),
  liveWorkspace: vi.fn(async (workspace) => ({ workspace, source: "NOT_CONNECTED", note: "no wallet", snapshot: null, portfolio: null })),
}));
vi.mock("@/lib/autopilot/store", () => ({
  loadWallet: vi.fn(async () => fake.wallet), loadMandate: vi.fn(async () => fake.mandate),
  agentDb: () => ({ rpc: fake.adminRpc, from: () => ({ select: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: [{ id: "run-1", state: "COMPLETED", decision: { kind: "INVEST", explanation: "Invested idle cash.", depositMinor: "5000000" }, created_at: "2026-10-19T10:00:00.000Z", failure: null, return_all: false }], error: null }) }) }) }) }) }),
}));
vi.mock("@/lib/autopilot/vault-http", () => ({ vaultView: vi.fn(async () => ({ vault: { address: "0x00000000000000000000000000000000000000aa", deployed: true }, balances: { cashMinor: "1000000", positionMinor: "2000000", redeemableMinor: "2000000", usycMinor: "3000000", usycRedeemableMinor: "3000000", usycAvailable: true, morphoApyBps: 512, usycApyBps: 350, observedAt: "2026-10-20T00:00:00.000Z" }, bills: [], needsYou: [{ code: "APPROVE_BILLS", message: "One bill needs your approval." }] })) }));
vi.mock("@/lib/gateway/balances", () => ({ readUnifiedUsdc: vi.fn() }));
vi.mock("@/lib/earn/gateway", () => ({ arcClient: { estimateGas: vi.fn(async () => 60_000n), getGasPrice: vi.fn(async () => 20_000_000_000n) }, discoverAllowedVaults: vi.fn(async () => [{ address: "0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88" }]) }));

import { GET as metadata } from "@/app/.well-known/oauth-protected-resource/[[...path]]/route";
import { POST } from "@/app/api/mcp/route";

let id = 0;
async function call(method: string, params: object, token = "good") {
  const response = await POST(new Request("https://app.hoddfinance.xyz/api/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, "mcp-protocol-version": "2025-06-18" }, body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }) }));
  const text = await response.text();
  const json = text.startsWith("{") ? JSON.parse(text) : JSON.parse(text.split("\n").find((line) => line.startsWith("data: "))!.slice(6));
  return { status: response.status, body: json };
}
const toolText = (body: { result: { content: { text: string }[]; isError?: boolean } }) => body.result.content[0].text;

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("HODD_MCP_HANDLE_SECRET", "s".repeat(48)); fake.revision = 5; fake.wallet = null; fake.mandate = null; fake.rpc.mockResolvedValue({ data: 6, error: null }); fake.adminRpc.mockResolvedValue({ data: null, error: null }); });

describe("Hodd MCP endpoint", () => {
  it("challenges unauthenticated clients and publishes exact protected-resource metadata", async () => {
    const response = await POST(new Request("https://app.hoddfinance.xyz/api/mcp", { method: "POST", headers: { "content-type": "application/json", host: "app.hoddfinance.xyz" }, body: "{}" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain('resource_metadata="https://app.hoddfinance.xyz/.well-known/oauth-protected-resource/api/mcp"');
    const doc = await metadata(new Request("https://app.hoddfinance.xyz/.well-known/oauth-protected-resource/api/mcp", { headers: { host: "app.hoddfinance.xyz" } })).json();
    expect(doc).toMatchObject({ resource: "https://app.hoddfinance.xyz/api/mcp", authorization_servers: ["https://example.supabase.co/auth/v1"] });
    expect((await call("tools/list", {}, "bad")).status).toBe(401);
  });

  it("lists read tools as read-only and write tools as destructive", async () => {
    const { body } = await call("tools/list", {});
    const tools = body.result.tools as { name: string; title?: string; annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean } }[];
    const byName = Object.fromEntries(tools.map((tool) => [tool.name, tool]));
    for (const name of ["hodd_whoami", "hodd_get_overview", "hodd_list_obligations", "hodd_check_payment", "hodd_prepare_change", "hodd_list_requests", "hodd_get_autopilot", "hodd_get_unified_balance", "hodd_list_vaults_and_positions"]) expect(byName[name]?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    for (const name of ["hodd_create_obligation", "hodd_update_obligation", "hodd_update_policy", "hodd_set_allocation_targets", "hodd_request_payment", "hodd_request_earn", "hodd_dismiss_request", "hodd_delete_obligation", "hodd_request_usyc", "hodd_request_autopilot", "hodd_pause_autopilot"]) expect(byName[name]?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
    expect(tools.every((tool) => tool.title)).toBe(true);
  });

  it("answers a read question with live-policy numbers", async () => {
    const { body } = await call("tools/call", { name: "hodd_get_overview", arguments: {} });
    const overview = JSON.parse(toolText(body));
    expect(overview).toMatchObject({ dataSource: "NOT_CONNECTED", totalTreasury: expect.stringContaining("USDC"), deployableCapital: expect.stringContaining("USDC") });
  });

  it("prepares, then applies only the exact approved change, once", async () => {
    const change = { title: "Office rent", amount: "1500", dueDate: "2026-10-20", category: "RENT" };
    const prepared = await call("tools/call", { name: "hodd_prepare_change", arguments: { kind: "CREATE_OBLIGATION", change } });
    const preview = JSON.parse(toolText(prepared.body));
    expect(preview.approvalRequired).toContain("Nothing has changed yet");
    expect(fake.rpc).not.toHaveBeenCalled();
    const args = preview.confirmWith.arguments;
    expect(preview.confirmWith.tool).toBe("hodd_create_obligation");

    const tampered = await call("tools/call", { name: "hodd_create_obligation", arguments: { ...args, amount: "9999" } });
    expect(tampered.body.result.isError).toBe(true); expect(toolText(tampered.body)).toContain("differ");
    expect(fake.rpc).not.toHaveBeenCalled();

    const applied = await call("tools/call", { name: "hodd_create_obligation", arguments: args });
    expect(JSON.parse(toolText(applied.body))).toMatchObject({ status: "APPLIED", workspaceRevision: 6 });
    expect(fake.rpc).toHaveBeenCalledWith("hodd_apply_agent_action", expect.objectContaining({ p_kind: "CREATE_OBLIGATION", p_status: "APPLIED", p_revision: 5, p_expires_at: null }));
    const written = fake.rpc.mock.calls[0][1].p_workspace;
    expect(written.obligations.some((item: { title: string }) => item.title === "Office rent")).toBe(true);
    expect(written.activities[0]).toMatchObject({ actor: "AGENT", approval: "APPROVED" });

    fake.rpc.mockResolvedValueOnce({ data: null, error: { code: "23505", message: "duplicate key" } });
    const replay = await call("tools/call", { name: "hodd_create_obligation", arguments: args });
    expect(toolText(replay.body)).toContain("already used");
  });

  it("refuses a confirmation after the workspace changed and turns money moves into requests", async () => {
    const prepared = JSON.parse(toolText((await call("tools/call", { name: "hodd_prepare_change", arguments: { kind: "EARN_REQUEST", change: { operation: "DEPOSIT", amount: "0.5" } } })).body));
    fake.revision = 6;
    const stale = await call("tools/call", { name: "hodd_request_earn", arguments: prepared.confirmWith.arguments });
    expect(toolText(stale.body)).toContain("workspace changed");
    fake.revision = 5;
    const requested = JSON.parse(toolText((await call("tools/call", { name: "hodd_request_earn", arguments: prepared.confirmWith.arguments })).body));
    expect(requested.status).toBe("REQUESTED");
    expect(fake.rpc).toHaveBeenCalledWith("hodd_apply_agent_action", expect.objectContaining({ p_kind: "EARN_REQUEST", p_status: "OPEN", p_change: expect.objectContaining({ vaultAddress: "0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88" }) }));
  });

  it("pauses Autopilot only after approval, before recording it, and only when it runs", async () => {
    const notSetUp = await call("tools/call", { name: "hodd_prepare_change", arguments: { kind: "PAUSE_AUTOPILOT", change: {} } });
    expect(toolText(notSetUp.body)).toContain("not set up");
    fake.mandate = { mandate: { enabled: true, paused: false, budgetMinor: "10000000" }, revision: 1, spent_minor: "0", return_requested: false };
    const smoke = await call("tools/call", { name: "hodd_prepare_change", arguments: { scope: "SMOKE_TEST", kind: "PAUSE_AUTOPILOT", change: {} } });
    expect(toolText(smoke.body)).toContain("main treasury");
    const preview = JSON.parse(toolText((await call("tools/call", { name: "hodd_prepare_change", arguments: { kind: "PAUSE_AUTOPILOT", change: {} } })).body));
    expect(preview.confirmWith.tool).toBe("hodd_pause_autopilot"); expect(fake.adminRpc).not.toHaveBeenCalled();
    const paused = JSON.parse(toolText((await call("tools/call", { name: "hodd_pause_autopilot", arguments: preview.confirmWith.arguments })).body));
    expect(paused.status).toBe("APPLIED");
    expect(fake.adminRpc).toHaveBeenCalledWith("hodd_pause_agent", { p_user: "user-1" });
    expect(fake.adminRpc.mock.invocationCallOrder[0]).toBeLessThan(fake.rpc.mock.invocationCallOrder[0]);
    expect(fake.rpc).toHaveBeenCalledWith("hodd_apply_agent_action", expect.objectContaining({ p_kind: "PAUSE_AUTOPILOT", p_status: "APPLIED" }));
  });

  it("turns USYC and Autopilot actions into requests and deletes bills through the same approval", async () => {
    const usyc = JSON.parse(toolText((await call("tools/call", { name: "hodd_prepare_change", arguments: { kind: "USYC_REQUEST", change: { operation: "DEPOSIT", amount: "10" } } })).body));
    expect(JSON.parse(toolText((await call("tools/call", { name: "hodd_request_usyc", arguments: usyc.confirmWith.arguments })).body))).toMatchObject({ status: "REQUESTED", next: expect.stringContaining("USYC") });
    expect(fake.rpc).toHaveBeenLastCalledWith("hodd_apply_agent_action", expect.objectContaining({ p_kind: "USYC_REQUEST", p_status: "OPEN", p_expires_at: expect.any(String) }));
    const runNow = await call("tools/call", { name: "hodd_prepare_change", arguments: { kind: "AUTOPILOT_REQUEST", change: { operation: "RETURN_ALL" } } });
    expect(toolText(runNow.body)).toContain("Connect a wallet");
    const deletion = JSON.parse(toolText((await call("tools/call", { name: "hodd_prepare_change", arguments: { kind: "DELETE_OBLIGATION", change: { obligationId: "obl-aws-oct" } } })).body));
    fake.rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "obligation deletion is not supported" } });
    expect(toolText((await call("tools/call", { name: "hodd_delete_obligation", arguments: deletion.confirmWith.arguments })).body)).toContain("payment history");
  });

  it("reads Autopilot status for the main treasury", async () => {
    expect(JSON.parse(toolText((await call("tools/call", { name: "hodd_get_autopilot", arguments: {} })).body))).toMatchObject({ setUp: false, active: false });
    fake.wallet = { user_id: "user-1", address: "0x00000000000000000000000000000000000000bb", owner_address: "0x00000000000000000000000000000000000000cc", vault_address: "0x00000000000000000000000000000000000000aa" };
    fake.mandate = { mandate: { enabled: true, paused: false, budgetMinor: "10000000" }, revision: 1, spent_minor: "6000000", return_requested: false };
    const view = JSON.parse(toolText((await call("tools/call", { name: "hodd_get_autopilot", arguments: {} })).body));
    expect(view).toMatchObject({ setUp: true, active: true, state: "ACTIVE", balances: { cash: "1 USDC", morpho: "2 USDC", usyc: "3 USDC", morphoApy: "5.12%" }, needsYou: [{ code: "APPROVE_BILLS" }], recentRuns: [{ decision: "INVEST", deposited: "5 USDC" }] });
  });
});
