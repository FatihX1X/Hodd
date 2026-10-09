import { useEffect } from "react";
import userEvent from "@testing-library/user-event";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TreasuryWorkspaceProvider, operationalInput, useTreasuryWorkspace } from "./treasury-workspace-provider";
import { sampleWorkspace, usdc } from "@/lib/treasury/fixtures";
import { createLiveStarterWorkspace } from "@/lib/treasury/starter";
import type { TreasuryWorkspace, WalletConnection } from "@/lib/treasury/models";
import { InvestmentWorkspace } from "./investment-workspace";

const mocks = vi.hoisted(() => ({ owner: "alice" as string | undefined, load: vi.fn(), save: vi.fn(), listener: undefined as undefined | ((event: string, session: { user: { id: string } } | null) => void) }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: { onAuthStateChange: (callback: typeof mocks.listener) => { mocks.listener = callback; queueMicrotask(() => callback?.("INITIAL_SESSION", mocks.owner ? { user: { id: mocks.owner } } : null)); return { data: { subscription: { unsubscribe: () => undefined } } }; } } }) }));
vi.mock("@/lib/supabase/workspace-sync", () => ({ loadCloudWorkspace: mocks.load, syncWorkspaceToCloud: mocks.save, knownWorkspaceRevision: () => undefined, cloudWorkspaceRevision: async () => null, isRevisionConflict: (error: { code?: string }) => error.code === "40001" }));
const wallet: WalletConnection = { provider: "INJECTED_METAMASK", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address: "0x0000000000000000000000000000000000000001", label: "My wallet", connectedAt: "2026-10-09T12:00:00.000Z" };
let current: ReturnType<typeof useTreasuryWorkspace>;
function Probe() { const value = useTreasuryWorkspace(); useEffect(() => { current = value; }, [value]); return <p>{value.hydrated ? `${value.mode}:${value.signedIn}` : "Loading"}</p>; }
async function mount(children?: React.ReactNode) { render(<TreasuryWorkspaceProvider><Probe />{children}</TreasuryWorkspaceProvider>); await waitFor(() => expect(current.hydrated).toBe(true)); }
beforeEach(() => { mocks.owner = "alice"; mocks.load.mockReset().mockResolvedValue(null); mocks.save.mockReset().mockResolvedValue(undefined); window.localStorage.clear(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/"); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("LIVE / DEMO provider", () => {
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
  it("never writes or mutates the sample in DEMO even for a signed-in user", async () => {
    window.history.replaceState(null, "", "/?demo=1");
    const saved = JSON.stringify(createLiveStarterWorkspace()); window.localStorage.setItem("hodd.stage5.workspace.v4:alice", saved);
    await mount(); expect(screen.getByText("DEMO:true")).toBeVisible();
    const before = structuredClone(current.workspace);
    await act(async () => {
      current.connectWallet(wallet); current.disconnectWallet(); current.resetWorkspace(); current.refreshWallet(); current.refreshEarn();
      current.updatePolicy({ safetyBuffer: usdc("0"), minimumLiquidityCoverageBps: 0, strategyCapsBps: before.policy.strategyCapsBps });
      current.updateTargets({ LIQUID: 10000, MORPHO: 0, USYC: 0, BTC_RESERVE: 0 });
      current.createObligation({ ...before.obligations[0], status: "UPCOMING" }); current.updateObligation(before.obligations[0].id, { ...before.obligations[0], title: "Changed", status: "UPCOMING" });
      await current.deleteObligation(before.obligations[0].id); await current.cleanSampleData(); await current.syncForEarn(); await current.refreshPaymentLedger();
      current.recordEarnEvent("EARN_CONFIRMED"); current.recordEarnActivity("Changed", "Changed", "Changed");
    });
    expect(current.workspace).toEqual(before); expect(current.readOnly).toBe(true); expect(current.operationalWorkspace).toEqual(sampleWorkspace);
    expect(mocks.load).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("hodd.stage5.workspace.v4:alice")).toBe(saved);
    expect(window.sessionStorage.getItem("hodd:workspace-mode")).toBe("DEMO");
  });
  it("restores demo per tab and exits to the live cloud workspace", async () => {
    window.sessionStorage.setItem("hodd:workspace-mode", "DEMO"); await mount(); expect(current.mode).toBe("DEMO");
    await act(async () => current.exitDemo()); await waitFor(() => expect(current.hydrated && current.mode === "LIVE").toBe(true));
    expect(current.workspace.obligations).toEqual([]); expect(current.operationalWorkspace).toBeNull(); expect(window.location.search).not.toContain("demo");
  });
  it("blocks callbacks retained from LIVE after entering DEMO", async () => {
    await mount(); const connect = current.connectWallet; const create = current.createObligation; const record = current.recordEarnEvent;
    await act(async () => current.enterDemo()); await waitFor(() => expect(current.hydrated && current.mode === "DEMO").toBe(true));
    mocks.save.mockClear();
    await act(async () => { connect(wallet); create({ ...sampleWorkspace.obligations[0], title: "Late callback", status: "UPCOMING" }); record("EARN_CONFIRMED"); });
    expect(current.workspace).toEqual(sampleWorkspace); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("keeps rejected deletions and surfaces a friendly payment-history error", async () => {
    mocks.load.mockResolvedValue(sampleWorkspace); await mount(); mocks.save.mockRejectedValueOnce({ message: "obligation deletion is not supported" });
    await expect(current.deleteObligation("obl-aws-oct")).rejects.toThrow("This bill has payment history and cannot be deleted");
    expect(current.workspace.obligations).toEqual(sampleWorkspace.obligations);
    expect(JSON.parse(window.localStorage.getItem("hodd.stage5.workspace.v4:alice")!).obligations).toEqual(sampleWorkspace.obligations);
  });
  it("deletes an eligible bill after cloud acceptance and refuses paid/reserved bills", async () => {
    const workspace = structuredClone(sampleWorkspace); workspace.obligations[0].status = "PAID";
    workspace.paymentReservations = [{ proposalId: "00000000-0000-4000-8000-000000000001", obligationId: "obl-invoice-104", amount: usdc("1"), feeReserve: usdc("0") }];
    mocks.load.mockResolvedValue(workspace); await mount();
    await expect(current.deleteObligation("obl-payroll-oct")).rejects.toThrow("cannot be deleted");
    await expect(current.deleteObligation("obl-invoice-104")).rejects.toThrow("cannot be deleted");
    await act(async () => { await current.deleteObligation("obl-aws-oct"); });
    expect(current.workspace.obligations.map((item) => item.id)).toEqual(["obl-payroll-oct", "obl-invoice-104"]);
  });
  it("cleans samples only after cloud acceptance", async () => {
    mocks.load.mockResolvedValue(sampleWorkspace); await mount(); await act(async () => { await current.cleanSampleData(); });
    expect(current.workspace.obligations).toEqual([]); expect(current.workspace.policy.safetyBuffer).toEqual(usdc("1000000"));
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
  });
});
