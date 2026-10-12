import { useEffect } from "react";
import { autopilotIsActive } from "@/lib/autopilot/protection";
import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreasuryWorkspaceProvider, operationalInput, useTreasuryWorkspace } from "./treasury-workspace-provider";
import { sampleWorkspace, usdc } from "@/test/fixtures";
import { createLiveStarterWorkspace } from "@/lib/treasury/starter";
import type { TreasuryWorkspace, WalletConnection } from "@/lib/treasury/models";
import { InvestmentWorkspace } from "./investment-workspace";

const mocks = vi.hoisted(() => ({ owner: "alice" as string | undefined, load: vi.fn(), save: vi.fn(), listener: undefined as undefined | ((event: string, session: { user: { id: string } } | null) => void) }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.listener) => { mocks.listener = callback; queueMicrotask(() => callback?.("INITIAL_SESSION", mocks.owner ? { user: { id: mocks.owner } } : null)); return { data: { subscription: { unsubscribe: () => undefined } } }; } } }) }));
vi.mock("@/lib/supabase/workspace-sync", () => ({ loadCloudWorkspace: mocks.load, syncWorkspaceToCloud: mocks.save, knownWorkspaceRevision: () => undefined, cloudWorkspaceRevision: async () => null, isRevisionConflict: (error: { code?: string }) => error.code === "40001" }));
function userWorkspace(): TreasuryWorkspace {
  const workspace = structuredClone(sampleWorkspace);
  workspace.obligations.forEach((item, index) => { item.id = ["user-payroll", "user-aws", "user-invoice"][index]; });
  workspace.activities = []; workspace.decisions = [];
  workspace.policy.safetyBuffer = usdc("2000000");
  workspace.targetAllocationsBps = { LIQUID: 5000, MORPHO: 5000, USYC: 0, BTC_RESERVE: 0 };
  return workspace;
}
const wallet: WalletConnection = { provider: "INJECTED_METAMASK", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address: "0x0000000000000000000000000000000000000001", label: "My wallet", connectedAt: "2026-10-09T12:00:00.000Z" };
let current: ReturnType<typeof useTreasuryWorkspace>;
function Probe() { const value = useTreasuryWorkspace(); useEffect(() => { current = value; }, [value]); return <p>{value.hydrated ? `${value.mode}:${value.signedIn}` : "Loading"}</p>; }
async function mount(children?: React.ReactNode) { render(<TreasuryWorkspaceProvider><Probe />{children}</TreasuryWorkspaceProvider>); await waitFor(() => expect(current.hydrated).toBe(true)); }
beforeEach(() => { mocks.owner = "alice"; mocks.load.mockReset().mockResolvedValue(null); mocks.save.mockReset().mockResolvedValue(undefined); window.localStorage.clear(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/"); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("LIVE provider", () => {
  it("uses active Autopilot for every assessment and restores manual protection on pause, return, errors and sign-out", async () => {
    const at = new Date(); const observedAt = at.toISOString();
    const workspace = { ...createLiveStarterWorkspace(at), treasuryMode: "ARC_TESTNET_WALLET" as const, walletConnection: wallet };
    workspace.obligations = [{ ...sampleWorkspace.obligations[0], id: "day-five", amount: usdc("2000000"), dueAt: new Date(at.getTime() + 5 * 86400000).toISOString() }];
    mocks.load.mockResolvedValue(workspace);
    let status = { mandate: { enabled: true, paused: false }, returnRequested: false }; let fail = false;
    const fetcher = vi.fn(async (url: string) => {
      // The server reduces the mandate to { active } (same rule as autopilotIsActive).
      if (url === "/api/autopilot/active") { if (fail) throw new Error("Unavailable"); return { ok: true, json: async () => ({ active: autopilotIsActive(status) }) }; }
      const data = url.includes("/api/arc/") ? { status: "READY", snapshot: { address: wallet.address, chain: "ARC-TESTNET", chainId: 5042002, balance: usdc("10000000"), blockNumber: "42", observedAt } } : { status: "READY", integration: { discovery: "READY", positionAccess: "READY", execution: "READ_ONLY", configuredWalletAddress: wallet.address, message: "Fixture" }, positions: [{ walletAddress: wallet.address, vaultAddress: wallet.address, vaultName: "Morpho", currentBalance: usdc("5000000"), redeemable: usdc("5000000"), maxWithdrawable: usdc("5000000"), liquidityStatus: "READY", shares: "5000000", apyBps: 0, pnl: { status: "UNAVAILABLE", reason: "Fixture" }, observedAt }], vaults: [], observedAt };
      return { ok: true, json: async () => data };
    }); vi.stubGlobal("fetch", fetcher); await mount();
    await waitFor(() => expect(current.assessment?.protectionLeadDays).toBe(3));
    expect(current.assessment?.upcomingObligations.minorUnits).toBe("0"); expect(current.assessment?.plannedObligations.minorUnits).toBe("2000000");
    expect(current.operationalWorkspace?.strategies.find((item) => item.kind === "MORPHO")).toMatchObject({ observedAt, liquidityStatus: "READY" });
    for (const change of [{ mandate: { enabled: true, paused: true }, returnRequested: false }, { mandate: { enabled: true, paused: false }, returnRequested: true }]) {
      status = change; await act(async () => { window.dispatchEvent(new Event("hodd:autopilot-status")); });
      await waitFor(() => expect(current.assessment?.protectionLeadDays).toBe(7)); expect(current.assessment?.upcomingObligations.minorUnits).toBe("2000000");
    }
    status = { mandate: { enabled: true, paused: false }, returnRequested: false };
    await act(async () => { window.dispatchEvent(new Event("hodd:autopilot-status")); }); await waitFor(() => expect(current.autopilotActive).toBe(true));
    await act(async () => { current.updatePolicy({ safetyBuffer: usdc("3000000"), minimumLiquidityCoverageBps: 10000, strategyCapsBps: workspace.policy.strategyCapsBps, protectionLeadDays: null }); });
    expect(current.assessment?.protectedCapital.minorUnits).toBe("3000000"); expect(current.allocationPlan?.deployableCapital.minorUnits).toBe("12000000");
    fail = true; await act(async () => { window.dispatchEvent(new Event("hodd:autopilot-status")); }); await waitFor(() => expect(current.autopilotActive).toBe(false));
    expect(current.assessment?.protectionLeadDays).toBe(7);
    await act(async () => { mocks.listener?.("SIGNED_OUT", null); }); await waitFor(() => expect(current.signedIn).toBe(false)); expect(current.autopilotActive).toBe(false);
  });
  it("ignores obsolete URL and per-tab mode preferences", async () => {
    window.history.replaceState(null, "", "/?demo=1");
    window.sessionStorage.setItem("hodd:workspace-mode", "DEMO");
    await mount();
    expect(current.mode).toBe("LIVE"); expect(current.readOnly).toBe(false);
    expect(current.workspace.obligations).toEqual([]); expect(current.operationalWorkspace).toBeNull();
    expect(mocks.load).toHaveBeenCalledWith("alice", "TREASURY");
  });
  it("automatically cleans legacy records once, preserving user and paid or reserved records", async () => {
    const workspace = structuredClone(sampleWorkspace);
    workspace.obligations[0].status = "PAID";
    workspace.obligations.push({ ...workspace.obligations[1], id: "user-bill" });
    workspace.paymentReservations = [{ proposalId: "00000000-0000-4000-8000-000000000001", obligationId: workspace.obligations[2].id, amount: usdc("1"), feeReserve: usdc("0") }];
    mocks.load.mockResolvedValue(workspace); await mount();
    expect(current.workspace.obligations.map(item => item.id)).toEqual([workspace.obligations[0].id, workspace.obligations[2].id, "user-bill"]);
    expect(current.workspace.activities).toEqual([expect.objectContaining({ actor: "SYSTEM", action: "Sample records removed" })]);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(JSON.parse(window.localStorage.getItem("hodd.stage5.workspace.v4:alice")!).obligations).toEqual(current.workspace.obligations);
    await act(async () => { mocks.listener?.("TOKEN_REFRESHED", { user: { id: "alice" } }); });
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("keeps records when automatic cleanup cannot be accepted by the cloud", async () => {
    mocks.load.mockResolvedValue(sampleWorkspace); mocks.save.mockRejectedValueOnce(new Error("sync failed"));
    await mount();
    expect(current.workspace).toEqual(sampleWorkspace);
    expect(screen.getByRole("status")).toHaveTextContent("Legacy record cleanup could not be saved");
    expect(mocks.save).toHaveBeenCalledTimes(1);
  });
  it("saves the empty starter immediately for a new signed-in user and pauses totals", async () => {
    await mount();
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ obligations: [], totalTreasury: usdc("0") }), "alice", "TREASURY");
    expect(current.operationalWorkspace).toBeNull(); expect(current.assessment).toBeNull();
    expect(current.workspace.activities[0].action).toBe("Workspace created");
  });
  it("ignores guest and older stored fake balances without a wallet", async () => {
    window.localStorage.setItem("hodd.stage5.workspace.v4", JSON.stringify(sampleWorkspace));
    mocks.load.mockResolvedValue(sampleWorkspace);
    await mount(); expect(current.operationalWorkspace).toBeNull(); expect(current.allocationPlan).toBeNull();
    expect(operationalInput(sampleWorkspace, { status: "IDLE" })).toBeNull();
  });



  it("keeps rejected deletions and surfaces a friendly payment-history error", async () => {
    const workspace = userWorkspace(); mocks.load.mockResolvedValue(workspace); await mount(); mocks.save.mockRejectedValueOnce({ message: "obligation deletion is not supported" });
    await expect(current.deleteObligation("user-aws")).rejects.toThrow("This bill has payment history and cannot be deleted");
    expect(current.workspace.obligations).toEqual(workspace.obligations);
    expect(JSON.parse(window.localStorage.getItem("hodd.stage5.workspace.v4:alice")!).obligations).toEqual(workspace.obligations);
  });
  it("deletes an eligible bill after cloud acceptance and refuses paid/reserved bills", async () => {
    const workspace = userWorkspace(); workspace.obligations[0].status = "PAID";
    workspace.paymentReservations = [{ proposalId: "00000000-0000-4000-8000-000000000001", obligationId: "user-invoice", amount: usdc("1"), feeReserve: usdc("0") }];
    mocks.load.mockResolvedValue(workspace); await mount();
    await expect(current.deleteObligation("user-payroll")).rejects.toThrow("cannot be deleted");
    await expect(current.deleteObligation("user-invoice")).rejects.toThrow("cannot be deleted");
    await act(async () => { await current.deleteObligation("user-aws"); });
    expect(current.workspace.obligations.map((item) => item.id)).toEqual(["user-payroll", "user-invoice"]);
  });

  it("starts an independent workspace on identity changes", async () => {
    mocks.load.mockResolvedValueOnce(sampleWorkspace); await mount();
    await act(async () => { mocks.listener?.("SIGNED_IN", { user: { id: "bob" } }); });
    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ obligations: [] }), "bob", "TREASURY"));
    expect(current.workspace.obligations).toEqual([]); expect(current.assessment).toBeNull();
  });
  it("shows live strategy APY and balances and locks unsupported targets at zero", async () => {
    const user = userEvent.setup();
    const workspace: TreasuryWorkspace = { ...createLiveStarterWorkspace(), treasuryMode: "ARC_TESTNET_WALLET", walletConnection: wallet };
    mocks.load.mockResolvedValue(workspace);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ json: async () => url.includes("/api/arc/") ? { status: "READY", snapshot: { address: wallet.address, chain: "ARC-TESTNET", chainId: 5042002, balance: usdc("20000000"), blockNumber: "42", observedAt: wallet.connectedAt } } : { status: "READY", integration: { discovery: "READY", positionAccess: "READY", execution: "READ_ONLY", configuredWalletAddress: wallet.address, message: "Live vault data" }, positions: [], vaults: [{ address: wallet.address, name: "Live Morpho vault", chain: "ARC-TESTNET", protocol: "MORPHO", asset: "USDC", assetAddress: wallet.address, apyBps: 725, totalDeposits: usdc("100000000"), liquidity: usdc("100000000"), status: "ACTIVE", circleGuarded: false, warnings: [], earnKitWarnings: [], verifiedAt: wallet.connectedAt, verifiedBlock: "42" }], observedAt: wallet.connectedAt } })));
    await mount(<InvestmentWorkspace />);
    await waitFor(() => expect(current.operationalWorkspace?.totalTreasury).toEqual(usdc("20000000")));
    expect(screen.getByLabelText("USYC target")).toBeDisabled(); expect(screen.getByLabelText("USYC target")).toHaveValue("0");
    expect(screen.getByLabelText("BTC Reserve target")).toBeDisabled();
    expect(screen.getAllByText("Not on Arc Testnet")).toHaveLength(2);
    expect(screen.getAllByText("LIVE").length).toBeGreaterThan(0);
    await waitFor(() => expect(current.operationalWorkspace?.strategies.find((item) => item.kind === "MORPHO")?.apyBps).toBe(725));
    expect(screen.getAllByText("7.25%").length).toBeGreaterThan(0);
    await user.clear(screen.getByLabelText("Morpho target")); await user.type(screen.getByLabelText("Morpho target"), "40");
    await user.click(screen.getByRole("button", { name: "Save targets" })); expect(screen.getByRole("alert")).toHaveTextContent("exactly 100%");
    await user.clear(screen.getByLabelText("Liquid USDC target")); await user.type(screen.getByLabelText("Liquid USDC target"), "60"); await user.click(screen.getByRole("button", { name: "Save targets" }));
    expect(current.workspace.targetAllocationsBps).toEqual({ LIQUID: 6000, MORPHO: 4000, USYC: 0, BTC_RESERVE: 0 });
    const preview = screen.getByRole("button", { name: /preview engine plan/i }); await user.click(preview);
    expect(screen.getByRole("dialog", { name: /allocation plan/i })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /close investment preview/i })); expect(preview).toHaveFocus();
  });
});
