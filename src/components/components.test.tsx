import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { ActivityLedger } from "./activity-ledger";
import { InvestmentWorkspace } from "./investment-workspace";
import { ObligationExplorer } from "./obligation-explorer";
import { StatusPill } from "./primitives";
import { demoTreasury } from "@/lib/treasury/fixtures";

vi.mock("next/navigation", () => ({ usePathname: () => "/obligations" }));

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("Stage 1 interactions", () => {
  it("marks the active navigation destination", () => {
    render(<AppShell><div>Content</div></AppShell>);
    const desktopNav = screen.getByRole("navigation", { name: "Primary navigation" });
    expect(within(desktopNav).getByRole("link", { name: "Obligations" })).toHaveAttribute("aria-current", "page");
  });

  it("opens a review-only investment preview and returns focus when closed", async () => {
    const user = userEvent.setup();
    render(<InvestmentWorkspace portfolio={demoTreasury.portfolio} strategies={demoTreasury.strategies} />);
    const trigger = screen.getByRole("button", { name: /preview sample plan/i });
    await user.click(trigger);
    expect(screen.getByRole("dialog", { name: /sample investment plan/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /execution unavailable/i })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /close investment preview/i }));
    expect(trigger).toHaveFocus();
  });

  it("filters obligations and opens the selected read-only detail", async () => {
    const user = userEvent.setup();
    render(<ObligationExplorer obligations={demoTreasury.obligations} />);
    await user.click(screen.getByRole("button", { name: "DRAFT" }));
    expect(screen.getByText("Invoice #104")).toBeInTheDocument();
    expect(screen.queryByText("October payroll")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /view details for invoice #104/i }));
    expect(screen.getByRole("dialog", { name: "Invoice #104" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /payment preview begins/i })).toBeDisabled();
  });

  it("filters the activity ledger by actor", () => {
    render(<ActivityLedger activities={demoTreasury.activities} />);
    fireEvent.click(screen.getByRole("button", { name: "AGENT" }));
    expect(screen.getByText("Allocation recommendation prepared")).toBeInTheDocument();
    expect(screen.queryByText("Safety buffer recorded")).not.toBeInTheDocument();
  });

  it("renders a textual state in addition to color", () => {
    render(<StatusPill label="SAFE" tone="success" />);
    expect(screen.getByText("SAFE")).toBeVisible();
  });
});
