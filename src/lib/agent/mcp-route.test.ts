// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "@/lib/treasury/fixtures";

const fake = vi.hoisted(() => ({ rpc: vi.fn(), revision: 5 }));
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

beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("HODD_MCP_HANDLE_SECRET", "s".repeat(48)); fake.revision = 5; fake.rpc.mockResolvedValue({ data: 6, error: null }); });

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
    for (const name of ["hodd_whoami", "hodd_get_overview", "hodd_list_obligations", "hodd_check_payment", "hodd_prepare_change", "hodd_list_requests"]) expect(byName[name]?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    for (const name of ["hodd_create_obligation", "hodd_update_obligation", "hodd_update_policy", "hodd_set_allocation_targets", "hodd_request_payment", "hodd_request_earn", "hodd_dismiss_request"]) expect(byName[name]?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
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
});
