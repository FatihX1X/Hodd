import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AllocationBar, RunwayChart, WeeklyOutflowChart } from "./charts";
import { ObligationExplorer } from "./obligation-explorer";
import { PolicyView } from "./policy-view";
import { StrategyTable } from "./strategy-table";
import { TreasuryWorkspaceProvider } from "./treasury-workspace-provider";
import { initialWorkspace } from "@/lib/treasury/fixtures";
import { allocationByLiquidity, runwayProjection, weeklyOutflows } from "@/lib/treasury/views";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
const earnReadOnlyResponse = { status: "READY", integration: { discovery: "READY", positionAccess: "NOT_CONFIGURED", execution: "READ_ONLY", configuredWalletAddress: null, message: "Live vault discovery; wallet credentials are not configured." }, vaults: [], positions: [], observedAt: "2026-09-28T12:00:00.000Z" };
const renderWorkspace = (node: React.ReactNode) => render(<TreasuryWorkspaceProvider>{node}</TreasuryWorkspaceProvider>);
const at = new Date("2026-09-27T00:00:00.000Z");

beforeEach(() => { window.localStorage.clear(); vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => earnReadOnlyResponse }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("strategy table", () => {
  it("lists every strategy and explains the selected one", async () => {
    const user = userEvent.setup();
    render(<StrategyTable workspace={initialWorkspace} strategies={initialWorkspace.strategies} />);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("row")).toHaveLength(initialWorkspace.strategies.length + 1);
    const detail = screen.getByRole("complementary", { name: "Liquid USDC detail" });
    expect(within(detail).getByText("Instant.", { exact: false })).toBeVisible();
    expect(within(detail).queryByText("Policy cap")).not.toBeInTheDocument();

    await user.click(within(table).getByRole("button", { name: /morpho usdc vault/i }));
    const morpho = screen.getByRole("complementary", { name: "Morpho USDC Vault detail" });
    expect(within(morpho).getByText("Policy cap")).toBeVisible();
    expect(within(morpho).getByText(/up to 60% of the treasury, 6,000.00 USDC/i)).toBeVisible();
    expect(within(table).getByRole("button", { name: /morpho usdc vault/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("states that a disabled strategy keeps capital liquid", async () => {
    const user = userEvent.setup();
    render(<StrategyTable workspace={initialWorkspace} strategies={initialWorkspace.strategies} />);
    await user.click(within(screen.getByRole("table")).getByRole("button", { name: /usyc reserve/i }));
    expect(screen.getByText(/disabled by policy/i)).toBeVisible();
  });
});

describe("charts", () => {
  it("shows the runway as a chart with an accessible summary and switches to a table of every day", async () => {
    const user = userEvent.setup();
    const series = runwayProjection(initialWorkspace, at);
    render(<RunwayChart series={series} />);
    expect(screen.getByRole("img", { name: /projected treasury balance over 30 days/i })).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Table" }));
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(series.points.length + 1);
  });

  it("renders weekly outflows with a total in its description and a tooltip only on hover", () => {
    const weeks = weeklyOutflows(initialWorkspace.obligations, at);
    const { container } = render(<WeeklyOutflowChart weeks={weeks} />);
    expect(screen.getByRole("img", { name: /protected outflows by week for the next 13 weeks: 4,500.00 usdc in total/i })).toBeVisible();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    const busiest = weeks.findIndex((week) => week.total === Math.max(...weeks.map((item) => item.total)));
    fireEvent.pointerEnter(container.querySelectorAll(".flex.h-full")[busiest]);
    expect(screen.getByRole("status")).toHaveTextContent(/4,000.00 USDC/);
    expect(screen.getByRole("status")).toHaveTextContent(/october payroll/i);
  });

  it("describes the allocation by liquidity and names an empty state", () => {
    const { rerender } = render(<AllocationBar rows={allocationByLiquidity(initialWorkspace.strategies)} />);
    expect(screen.getByRole("img", { name: /allocation by liquidity: liquid usdc 100.0%/i })).toBeVisible();
    rerender(<AllocationBar rows={[]} />);
    expect(screen.getByText(/no balance is held in any strategy/i)).toBeVisible();
  });
});

describe("obligations detail", () => {
  it("shows the funding plan for the next payment and follows the selection", async () => {
    const user = userEvent.setup();
    renderWorkspace(<ObligationExplorer />);
    const plan = await screen.findByRole("complementary", { name: "Payment plan" });
    expect(within(plan).getByText(/plan for october payroll/i)).toBeVisible();
    expect(within(plan).getByText("SAFE")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "AWS infrastructure" }));
    expect(within(screen.getByRole("complementary", { name: "Payment plan" })).getByText(/plan for aws infrastructure/i)).toBeVisible();
  });

  it("explains that draft records are not part of the protected total", async () => {
    const user = userEvent.setup();
    renderWorkspace(<ObligationExplorer />);
    await user.click(await screen.findByRole("button", { name: "Invoice #104" }));
    expect(within(screen.getByRole("complementary", { name: "Payment plan" })).getByText(/not part of the protected total/i)).toBeVisible();
  });

  it("filters the calendar with the status toggle", async () => {
    const user = userEvent.setup();
    renderWorkspace(<ObligationExplorer />);
    await user.click(await screen.findByRole("button", { name: "DRAFT" }));
    expect(screen.getByRole("button", { name: "Invoice #104" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "October payroll" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "DRAFT" })).toHaveAttribute("aria-pressed", "true");
  });
});

describe("policy page", () => {
  it("states the policy in plain language and saves new values", async () => {
    const user = userEvent.setup();
    renderWorkspace(<PolicyView />);
    expect(await screen.findByText(/protect obligations due in the next 30 days plus a 1,000.00 usdc safety buffer/i)).toBeVisible();
    expect(screen.getByText(/place at most 60% in morpho/i)).toBeVisible();
    await user.clear(screen.getByLabelText("Safety buffer")); await user.type(screen.getByLabelText("Safety buffer"), "1500");
    await user.click(screen.getByRole("button", { name: /save policy and recalculate/i }));
    expect(await screen.findByText(/1,500.00 usdc safety buffer/i)).toBeVisible();
  });

  it("rejects percentages outside 0-100", async () => {
    const user = userEvent.setup();
    renderWorkspace(<PolicyView />);
    const coverage = await screen.findByLabelText("Minimum liquidity coverage");
    await user.clear(coverage); await user.type(coverage, "150");
    await user.click(screen.getByRole("button", { name: /save policy and recalculate/i }));
    expect(screen.getByRole("alert")).toHaveTextContent(/between 0 and 100/i);
  });
});
