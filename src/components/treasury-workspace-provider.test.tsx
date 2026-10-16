import { StrictMode, useEffect } from "react";
import { autopilotIsActive } from "@/lib/autopilot/protection";
import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreasuryWorkspaceProvider, operationalInput, useTreasuryWorkspace } from "./treasury-workspace-provider";
import { sampleWorkspace, usdc } from "@/test/fixtures";
import { createLiveStarterWorkspace } from "@/lib/treasury/starter";
import type { TreasuryWorkspace, WalletConnection } from "@/lib/treasury/models";
import { InvestmentWorkspace } from "./investment-workspace";
import { liquiditySources } from "@/lib/treasury/engine";
import { makeActivity } from "@/lib/treasury/live";
import type { UsycPosition } from "@/lib/usyc/models";

const mocks = vi.hoisted(() => ({ owner: "alice" as string | undefined, load: vi.fn(), save: vi.fn(), refresh: vi.fn(), listener: undefined as undefined | ((event: string, session: { user: { id: string } } | null) => void) }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.listener) => { mocks.listener = callback; queueMicrotask(() => callback?.("INITIAL_SESSION", mocks.owner ? { user: { id: mocks.owner } } : null)); return { data: { subscription: { unsubscribe: () => undefined } } }; } } }) }));
vi.mock("@/lib/supabase/workspace-sync", () => ({ loadCloudWorkspace: mocks.load, syncWorkspaceToCloud: mocks.save, refreshCloudLedger: mocks.refresh, knownWorkspaceRevision: () => undefined, cloudWorkspaceRevision: async () => null, isRevisionConflict: (error: { code?: string }) => error.code === "40001" || error.code === "PT409" }));
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
beforeEach(() => { mocks.owner = "alice"; mocks.load.mockReset().mockResolvedValue(null); mocks.save.mockReset().mockResolvedValue(undefined); mocks.refresh.mockReset(); window.localStorage.clear(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/"); vi.stubGlobal("fetch", vi.fn()); });
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

  it("counts the wallet's USYC pool share in the treasury, and as liquidity only while Circle permits the pool", () => {
    const workspace: TreasuryWorkspace = { ...createLiveStarterWorkspace(), treasuryMode: "ARC_TESTNET_WALLET", walletConnection: wallet };
    const observedAt = new Date().toISOString();
    const walletState = { status: "READY" as const, snapshot: { address: wallet.address, chain: "ARC-TESTNET" as const, chainId: 5042002 as const, balance: { currency: "USDC" as const, decimals: 6 as const, minorUnits: "20000000" }, blockNumber: "42", observedAt } };
    const position: UsycPosition = { wallet: wallet.address, pool: "0x4F1E3B1c0A9D8E7f6a5B4C3D2E1f0A9b8C7d6E5f", circle: "OK", depositsPaused: false, maxDepositUsdc: "1000000000", shares: "8000000000000", usycMinor: "7999999", valueUsdc: "9117958", maxWithdrawShares: "3000000000000", maxWithdrawUsdc: "3419234", priceUsdcPerUsyc: "1139744957475496722", subscribePriceUsdcPerUsyc: "1139744957475496722", afterHoursPricing: false, observedAt };
    const usycState = (patch: Partial<UsycPosition> = {}) => ({ status: "READY" as const, data: { status: "READY" as const, position: { ...position, ...patch }, executionEnabled: true, executionNote: null, walletCanSign: true } });
    const live = operationalInput(workspace, walletState, undefined, usycState())!;
    expect(live.totalTreasury).toEqual(usdc("29117958"));
    expect(live.strategies.find((item) => item.kind === "USYC")).toMatchObject({ name: "USYC · via Hodd's pool", integration: "LIVE", liquidityStatus: "READY", balance: usdc("9117958"), redeemable: usdc("3419234") });
    expect(liquiditySources(live, new Date(observedAt)).find((item) => item.source === "USYC")?.available).toEqual(usdc("3419234"));
    // Held but not withdrawable while Circle has not enabled (or paused) the pool.
    const waiting = operationalInput(workspace, walletState, undefined, usycState({ circle: "NOT_PERMITTED" }))!;
    expect(waiting.totalTreasury).toEqual(usdc("29117958"));
    expect(liquiditySources(waiting, new Date(observedAt)).find((item) => item.source === "USYC")?.available).toEqual(usdc("0"));
    // Another wallet's position, or no pool yet, never counts.
    expect(operationalInput(workspace, walletState, undefined, usycState({ wallet: "0x00000000000000000000000000000000000000aa" }))!.totalTreasury).toEqual(usdc("20000000"));
    expect(operationalInput(workspace, walletState, undefined, { status: "READY", data: { ...usycState().data, position: null } })!.totalTreasury).toEqual(usdc("20000000"));
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
    expect(screen.getAllByText("Not on Arc Testnet")).toHaveLength(1);
    expect(screen.getByText("You choose in the pool card")).toBeInTheDocument();
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

// Cloud writes must stay proportional to what the user does, not to polling, re-renders or dev-mode double invocation.
describe("write amplification", () => {
  const liveState = { balance: 10_000_000, autopilot: false };
  const liveFetch = () => vi.fn(async (url: string) => {
    const observedAt = new Date().toISOString();
    if (url === "/api/autopilot/active") return { ok: true, json: async () => ({ active: liveState.autopilot }) };
    if (url === "/api/usyc") return { ok: false, json: async () => ({ message: "USYC data is temporarily unavailable." }) };
    if (url.includes("/api/arc/")) return { json: async () => ({ status: "READY", snapshot: { address: wallet.address, chain: "ARC-TESTNET", chainId: 5042002, balance: usdc(String(liveState.balance)), blockNumber: String(liveState.balance), observedAt } }) };
    return { json: async () => ({ status: "READY", integration: { discovery: "READY", positionAccess: "READY", execution: "READ_ONLY", configuredWalletAddress: wallet.address, message: "Fixture" }, positions: [], vaults: [], observedAt }) };
  });
  const walletWorkspace = (): TreasuryWorkspace => ({ ...createLiveStarterWorkspace(), treasuryMode: "ARC_TESTNET_WALLET", walletConnection: wallet });
  const count = (action: string) => current.workspace.activities.filter((item) => item.action === action).length;
  const targets = (liquid: number) => ({ LIQUID: liquid, MORPHO: 10_000 - liquid, USYC: 0, BTC_RESERVE: 0 });
  const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
  beforeEach(() => { liveState.balance = 10_000_000; liveState.autopilot = false; });

  it("persists an Earn audit record once even when React runs state updaters twice (StrictMode)", async () => {
    mocks.load.mockResolvedValue(userWorkspace());
    render(<StrictMode><TreasuryWorkspaceProvider><Probe /></TreasuryWorkspaceProvider></StrictMode>);
    await waitFor(() => expect(current.hydrated).toBe(true)); await settle(); mocks.save.mockClear();
    await act(async () => { current.recordEarnActivity("Earn quote reviewed", "Deposit quote prepared.", "Quote shown."); });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    await act(async () => { current.recordEarnEvent("TRANSACTION_SUBMITTED"); });
    expect(mocks.save).toHaveBeenCalledTimes(2);
    expect(count("Earn quote reviewed")).toBe(1);
    expect(mocks.save.mock.calls[1][0].activities.map((item: { action: string }) => item.action).slice(0, 2)).toEqual(["Earn transaction submitted", "Earn quote reviewed"]);
  });

  it("loads the cloud copy once after a conflict, however many writes were queued, and sends no further write", async () => {
    const mine = userWorkspace(); const cloud = { ...userWorkspace(), updatedAt: new Date(Date.now() + 60_000).toISOString() };
    mocks.load.mockResolvedValue(mine); await mount(); await settle(); mocks.save.mockClear();
    mocks.save.mockRejectedValue({ code: "PT409", message: "workspace revision conflict" }); mocks.refresh.mockResolvedValue(cloud);
    await act(async () => { current.updateTargets(targets(6000)); current.updateTargets(targets(7000)); current.updateTargets(targets(8000)); });
    await waitFor(() => expect(current.workspace.updatedAt).toBe(cloud.updatedAt)); await settle();
    expect(mocks.refresh).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(3);
    expect(screen.getByRole("status")).toHaveTextContent("changed elsewhere");
  });

  it("records the Treasury Engine only when its result changed", async () => {
    mocks.load.mockResolvedValue(userWorkspace()); await mount();
    await act(async () => { current.updateTargets(targets(6000)); });
    await act(async () => { current.updateTargets(targets(7000)); });
    expect(count("Treasury Engine paused")).toBe(1);
    expect(count("Allocation targets updated")).toBe(2);
  });
  it("records a new evaluation when the live balance moved the result", async () => {
    mocks.load.mockResolvedValue(walletWorkspace()); vi.stubGlobal("fetch", liveFetch()); await mount();
    await waitFor(() => expect(current.operationalWorkspace?.totalTreasury).toEqual(usdc("10000000")));
    await act(async () => { current.updateTargets(targets(6000)); }); await act(async () => { current.updateTargets(targets(7000)); });
    expect(count("Treasury Engine evaluated")).toBe(1);
    liveState.balance = 25_000_000; await act(async () => { window.dispatchEvent(new Event("focus")); });
    await waitFor(() => expect(current.operationalWorkspace?.totalTreasury).toEqual(usdc("25000000")));
    await act(async () => { current.updateTargets(targets(8000)); });
    expect(count("Treasury Engine evaluated")).toBe(2);
  });

  it("keeps the activity list bounded to the newest 200 entries", async () => {
    const full = userWorkspace(); full.activities = Array.from({ length: 205 }, (_, index) => makeActivity(`Old ${index}`, "s", "r", "2026-10-01T00:00:00.000Z"));
    mocks.load.mockResolvedValue(full); await mount(); mocks.save.mockClear();
    await act(async () => { current.updateTargets(targets(6000)); });
    expect(current.workspace.activities).toHaveLength(200);
    expect(current.workspace.activities[0].action).toBe("Treasury Engine paused"); expect(current.workspace.activities[1].action).toBe("Allocation targets updated");
    expect(mocks.save.mock.calls[0][0].activities).toHaveLength(200);
    await act(async () => { current.recordEarnActivity("Earn quote reviewed", "s", "r"); });
    expect(current.workspace.activities).toHaveLength(200); expect(current.workspace.activities[0].action).toBe("Earn quote reviewed");
  });

  it("does not write when a save changes nothing", async () => {
    const workspace = userWorkspace(); mocks.load.mockResolvedValue(workspace); await mount(); await settle(); mocks.save.mockClear();
    await act(async () => { current.updateTargets(workspace.targetAllocationsBps); });
    await act(async () => { current.updatePolicy({ safetyBuffer: workspace.policy.safetyBuffer, minimumLiquidityCoverageBps: workspace.policy.minimumLiquidityCoverageBps, strategyCapsBps: workspace.policy.strategyCapsBps, protectionLeadDays: workspace.policy.protectionLeadDays }); });
    expect(mocks.save).not.toHaveBeenCalled(); expect(current.workspace.activities).toEqual(workspace.activities);
  });

  it("makes zero cloud writes while wallet, Earn, USYC and Autopilot polls keep changing and the user does nothing", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
    try {
      mocks.load.mockResolvedValue(walletWorkspace()); vi.stubGlobal("fetch", liveFetch());
      current = undefined as unknown as typeof current; render(<StrictMode><TreasuryWorkspaceProvider><Probe /></TreasuryWorkspaceProvider></StrictMode>);
      for (let attempt = 0; attempt < 10 && !current?.hydrated; attempt++) await act(async () => { await vi.advanceTimersByTimeAsync(50); });
      expect(current.hydrated).toBe(true); await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      const baseline = mocks.save.mock.calls.length; const balances = new Set<string>();
      for (let second = 30; second <= 300; second += 30) {
        liveState.balance += 1_000_000; liveState.autopilot = !liveState.autopilot;
        await act(async () => { await vi.advanceTimersByTimeAsync(30_000); window.dispatchEvent(new Event("focus")); await vi.advanceTimersByTimeAsync(10); });
        if (current.walletState.status === "READY") balances.add(current.walletState.snapshot.balance.minorUnits);
      }
      expect(balances.size).toBeGreaterThanOrEqual(5); // the polls really moved the data
      expect(mocks.save.mock.calls.length).toBe(baseline);
    } finally { vi.useRealTimers(); }
  });
});
