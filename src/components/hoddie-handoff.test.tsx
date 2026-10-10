import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assessTreasury } from "@/lib/treasury/engine";
import { initialWorkspace } from "@/test/fixtures";
import type { EarnPortfolioResponse } from "@/lib/earn/models";
const fake = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[], mode: "LIVE", readOnly: false, limit: "4500000000", rpc: vi.fn(), earn: vi.fn(), payment: vi.fn() }));
const money = (minorUnits: string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits });
const address = "0x00000000000000000000000000000000000000a1";
const vault = { address, name: "Verified vault", status: "ACTIVE", liquidity: money("900000000") } as EarnPortfolioResponse["vaults"][number];
const position = { vaultAddress: address, currentBalance: money("300000000"), maxWithdrawable: money("300000000"), redeemable: money("250000000"), liquidityStatus: "READY" } as EarnPortfolioResponse["positions"][number];
const portfolio = { status: "READY", integration: { execution: "TESTNET_LIVE" }, vaults: [vault], positions: [position] } as EarnPortfolioResponse;
vi.mock("./treasury-workspace-provider", () => ({ useTreasuryWorkspace: () => ({ mode: fake.mode, readOnly: fake.readOnly, hydrated: true, workspaceScope: "TREASURY", workspace: initialWorkspace, operationalWorkspace: initialWorkspace, assessment: { ...assessTreasury(initialWorkspace, new Date("2026-09-27")), deployableCapital: money(fake.limit) }, earnState: { status: "READY", portfolio } }) }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }) }, rpc: fake.rpc, from: () => {
  const query = { select: () => query, eq: () => query, order: () => query, limit: async () => ({ data: fake.rows }) }; return query;
} }) }));
vi.mock("./earn-operation-dialog", () => ({ EarnOperationDialog: (props: Record<string, unknown>) => { fake.earn(props); return <button>Open normal Earn review</button>; } }));
vi.mock("./payment-dialog", () => ({ PaymentDialog: (props: Record<string, unknown>) => { fake.payment(props); return <button>Open normal payment review</button>; } }));
import { AgentRequests } from "./agent-requests";
const request = (kind: string, change: Record<string, unknown>) => ({ id: "request", kind, change, source: "HODDIE", summary: "Reviewed Hoddie request", created_at: "2026-10-09T10:00:00Z", expires_at: "2099-01-01T00:00:00Z" });
beforeEach(() => { vi.clearAllMocks(); fake.mode = "LIVE"; fake.readOnly = false; fake.limit = "4500000000"; fake.rows = []; });
afterEach(cleanup);
describe("Hoddie wallet-review handoff", () => {
  it.each(["DEPOSIT", "WITHDRAW"])("hands %s to the normal Earn dialog with the proposed amount and engine limit", async (operation) => {
    fake.rows = [request("EARN_REQUEST", { operation, amount: "100", vaultAddress: address })]; render(<AgentRequests />);
    await screen.findByRole("button", { name: "Open normal Earn review" });
    expect(fake.earn).toHaveBeenCalledWith(expect.objectContaining({ operation, vault, initialAmount: "100", enabled: true, policyLimit: money(operation === "DEPOSIT" ? "4500000000" : "250000000") }));
    expect(fake.rpc).not.toHaveBeenCalled();
  });
  it("withholds Earn handoff when current policy no longer covers the amount", async () => {
    fake.limit = "50000000"; fake.rows = [request("EARN_REQUEST", { operation: "DEPOSIT", amount: "100", vaultAddress: address })]; render(<AgentRequests />);
    await screen.findByText(/above the limit/); expect(fake.earn).not.toHaveBeenCalled(); expect(fake.rpc).not.toHaveBeenCalled();
  });
  it("does not silently replace a requested vault outside the allowlist", async () => {
    fake.rows = [request("EARN_REQUEST", { operation: "DEPOSIT", amount: "100", vaultAddress: "0x00000000000000000000000000000000000000ff" })]; render(<AgentRequests />);
    await screen.findByText(/not on the verified allowlist/); expect(fake.earn).not.toHaveBeenCalled();
  });
  it("hands payments to the normal payment dialog without submitting anything", async () => {
    const obligation = initialWorkspace.obligations[0]; fake.rows = [request("PAYMENT_REQUEST", { obligationId: obligation.id })]; render(<AgentRequests />);
    await screen.findByRole("button", { name: "Open normal payment review" }); expect(fake.payment).toHaveBeenCalledWith({ obligation }); expect(fake.rpc).not.toHaveBeenCalled();
  });
  it("read-only workspace never loads or resolves stored money requests", async () => {
    fake.readOnly = true; fake.rows = [request("EARN_REQUEST", { operation: "DEPOSIT", amount: "100", vaultAddress: address })]; render(<AgentRequests />);
    await waitFor(() => expect(screen.queryByText("Reviewed Hoddie request")).not.toBeInTheDocument()); expect(fake.earn).not.toHaveBeenCalled(); expect(fake.rpc).not.toHaveBeenCalled();
  });
});
