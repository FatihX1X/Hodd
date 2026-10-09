import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { InvestmentWorkspace } from "./investment-workspace";
import { ObligationExplorer } from "./obligation-explorer";
import { StatusPill } from "./primitives";
import { TreasuryWorkspaceProvider } from "./treasury-workspace-provider";
import { WalletPanel } from "./wallet-panel";



vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "test-user" } } }), onAuthStateChange: (callback: (event: string, session: { user: { id: string } }) => void) => { queueMicrotask(() => callback("INITIAL_SESSION", { user: { id: "test-user" } })); return { data: { subscription: { unsubscribe: () => undefined } } }; } } }) }));
vi.mock("@/lib/supabase/workspace-sync", () => ({ loadCloudWorkspace: async () => null, syncWorkspaceToCloud: async () => undefined, knownWorkspaceRevision: () => undefined, cloudWorkspaceRevision: async () => null, isRevisionConflict: () => false }));

vi.mock("next/navigation", () => ({ usePathname: () => "/obligations" }));
const renderWorkspace = (node: React.ReactNode) => render(<TreasuryWorkspaceProvider>{node}</TreasuryWorkspaceProvider>);
const earnReadOnlyResponse = { status: "READY", integration: { discovery: "READY", positionAccess: "NOT_CONFIGURED", execution: "READ_ONLY", configuredWalletAddress: null, message: "Live vault discovery; wallet credentials are not configured." }, vaults: [], positions: [], observedAt: "2026-09-28T12:00:00.000Z" };
beforeEach(() => { window.localStorage.clear(); window.sessionStorage.clear(); window.history.replaceState(null, "", "/"); window.HTMLElement.prototype.scrollIntoView = vi.fn(); vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => earnReadOnlyResponse }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Stage 4 interactions", () => {
  it("marks the active navigation destination", () => { renderWorkspace(<AppShell><div>Content</div></AppShell>); expect(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("link", { name: "Obligations" })).toHaveAttribute("aria-current", "page"); });
  it("creates and persists a real bill while financial calculations wait for a wallet", async () => {
    const user = userEvent.setup(); renderWorkspace(<ObligationExplorer />); await waitFor(() => expect(screen.getByRole("button", { name: /new obligation/i })).toBeEnabled()); await user.click(screen.getByRole("button", { name: /new obligation/i }));
    await user.type(screen.getByLabelText("Obligation title"), "Urgent invoice"); await user.type(screen.getByLabelText("Obligation amount"), "2000");
    await user.clear(screen.getByLabelText("Due date")); await user.type(screen.getByLabelText("Due date"), "2026-09-28"); await user.click(screen.getByRole("button", { name: /save and recalculate/i }));
    expect(await screen.findByText("Urgent invoice")).toBeVisible(); expect(screen.getByText(/financial totals are paused/i)).toBeVisible(); expect(JSON.parse(window.localStorage.getItem("hodd.stage5.workspace.v4:test-user")!).obligations).toEqual([expect.objectContaining({ title: "Urgent invoice", amount: { currency: "USDC", decimals: 6, minorUnits: "2000000000" } })]);
  });
  it("pauses allocation planning without a verified wallet", async () => { renderWorkspace(<InvestmentWorkspace />); expect(await screen.findByText(/connect your own Arc Testnet wallet from Overview/i)).toBeVisible(); expect(screen.queryByLabelText("Morpho target")).not.toBeInTheDocument(); });
  it("opens a deterministic allocation preview and returns focus", async () => { const user = userEvent.setup(); window.sessionStorage.setItem("hodd:workspace-mode", "DEMO"); renderWorkspace(<InvestmentWorkspace />); const trigger = await screen.findByRole("button", { name: /preview engine plan/i }); await user.click(trigger); expect(screen.getByRole("dialog", { name: /allocation plan/i })).toBeVisible(); expect(screen.getByRole("button", { name: /preview only/i })).toBeDisabled(); await user.click(screen.getByRole("button", { name: /close investment preview/i })); expect(trigger).toHaveFocus(); });
  it("renders a textual state in addition to color", () => { render(<StatusPill label="SAFE" tone="success" />); expect(screen.getByText("SAFE")).toBeVisible(); });
  it("offers user-owned wallet choices and restores focus", async () => {
    const user = userEvent.setup(); renderWorkspace(<WalletPanel />);
    const trigger = await screen.findByRole("button", { name: /choose wallet/i }); await user.click(trigger);
    for (const name of ["Circle Passkey", "Circle Embedded", "Browser wallet"]) expect(screen.getByRole("heading", { name })).toBeVisible();
    expect(screen.getByRole("button", { name: "MetaMask" })).toBeVisible(); expect(screen.getByRole("button", { name: "Rabby" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: /close wallet dialog/i })); expect(trigger).toHaveFocus();
  });
});
