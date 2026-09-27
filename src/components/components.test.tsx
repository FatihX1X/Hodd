import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { InvestmentWorkspace } from "./investment-workspace";
import { ObligationExplorer } from "./obligation-explorer";
import { StatusPill } from "./primitives";
import { TreasuryWorkspaceProvider } from "./treasury-workspace-provider";

vi.mock("next/navigation", () => ({ usePathname: () => "/obligations" }));
const renderWorkspace = (node: React.ReactNode) => render(<TreasuryWorkspaceProvider>{node}</TreasuryWorkspaceProvider>);
beforeEach(() => { window.localStorage.clear(); window.HTMLElement.prototype.scrollIntoView = vi.fn(); });
afterEach(cleanup);

describe("Stage 2 interactions", () => {
  it("marks the active navigation destination", () => { renderWorkspace(<AppShell><div>Content</div></AppShell>); expect(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("link", { name: "Obligations" })).toHaveAttribute("aria-current", "page"); });
  it("creates an obligation and recalculates protected capital", async () => {
    const user = userEvent.setup(); renderWorkspace(<ObligationExplorer />); await user.click(screen.getByRole("button", { name: /new obligation/i }));
    await user.type(screen.getByLabelText("Obligation title"), "Urgent invoice"); await user.type(screen.getByLabelText("Obligation amount"), "2000");
    await user.clear(screen.getByLabelText("Due date")); await user.type(screen.getByLabelText("Due date"), "2026-09-28"); await user.click(screen.getByRole("button", { name: /save and recalculate/i }));
    expect(await screen.findByText("Urgent invoice")).toBeVisible(); expect(screen.getByText("6,500.00 USDC")).toBeVisible(); expect(screen.getByText("2,500.00 USDC")).toBeVisible();
  });
  it("rejects allocation targets that do not total 100 percent", async () => { const user = userEvent.setup(); renderWorkspace(<InvestmentWorkspace />); await user.clear(screen.getByLabelText("Morpho target")); await user.type(screen.getByLabelText("Morpho target"), "40"); await user.click(screen.getByRole("button", { name: /save targets/i })); expect(screen.getByRole("alert")).toHaveTextContent("exactly 100%"); });
  it("opens a deterministic allocation preview and returns focus", async () => { const user = userEvent.setup(); renderWorkspace(<InvestmentWorkspace />); const trigger = screen.getByRole("button", { name: /preview engine plan/i }); await user.click(trigger); expect(screen.getByRole("dialog", { name: /allocation plan/i })).toBeVisible(); expect(screen.getByRole("button", { name: /execution begins/i })).toBeDisabled(); await user.click(screen.getByRole("button", { name: /close investment preview/i })); expect(trigger).toHaveFocus(); });
  it("renders a textual state in addition to color", () => { render(<StatusPill label="SAFE" tone="success" />); expect(screen.getByText("SAFE")).toBeVisible(); });
});
