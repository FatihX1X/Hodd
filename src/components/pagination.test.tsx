import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ActivityLedger } from "./activity-ledger";
import { Pagination } from "./primitives";
import { initialWorkspace } from "@/test/fixtures";
import type { ActivityEntry } from "@/lib/treasury/models";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const pager = (page: number, pageCount: number, extra: Partial<React.ComponentProps<typeof Pagination>> = {}) => <Pagination page={page} pageCount={pageCount} onChange={() => undefined} label="Test pages" {...extra} />;
const windowOf = () => [...screen.getByRole("navigation", { name: "Test pages" }).querySelectorAll("li")].map((item) => item.textContent);

describe("Pagination", () => {
  it("renders nothing when there is a single page", () => {
    const { container } = render(pager(1, 1)); expect(container).toBeEmptyDOMElement();
    cleanup(); expect(render(pager(1, 0)).container).toBeEmptyDOMElement();
  });

  it("keeps a compact window with ellipses around the current page", () => {
    const { rerender } = render(pager(5, 12)); expect(windowOf()).toEqual(["1", "…", "4", "5", "6", "…", "12"]);
    rerender(pager(1, 12)); expect(windowOf()).toEqual(["1", "2", "…", "12"]);
    rerender(pager(12, 12)); expect(windowOf()).toEqual(["1", "…", "11", "12"]);
    rerender(pager(4, 12)); expect(windowOf()).toEqual(["1", "2", "3", "4", "5", "…", "12"]);
    rerender(pager(2, 5)); expect(windowOf()).toEqual(["1", "2", "3", "4", "5"]);
  });

  it("marks only the current page and names each number", () => {
    render(pager(3, 5));
    const nav = screen.getByRole("navigation", { name: "Test pages" });
    expect(within(nav).getByRole("button", { name: "Page 3" })).toHaveAttribute("aria-current", "page");
    for (const name of ["Page 1", "Page 2", "Page 4", "Page 5"]) expect(within(nav).getByRole("button", { name })).not.toHaveAttribute("aria-current");
    expect(within(nav).getByText("Page 3 of 5")).toBeInTheDocument();
  });

  it("disables Previous on the first page and Next on the last", () => {
    const { rerender } = render(pager(1, 4)); expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled(); expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    rerender(pager(2, 4)); expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled(); expect(screen.getByRole("button", { name: "Next" })).toBeEnabled();
    rerender(pager(4, 4)); expect(screen.getByRole("button", { name: "Previous" })).toBeEnabled(); expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("reports the requested page and shows the visible range", async () => {
    const user = userEvent.setup();
    function Harness() { const [page, setPage] = useState(2); return <Pagination page={page} pageCount={5} onChange={setPage} label="Test pages" total={47} pageSize={10} />; }
    render(<Harness />);
    expect(screen.getByText("11–20 of 47")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Next" })); expect(screen.getByText("21–30 of 47")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Page 5" })); expect(screen.getByText("41–47 of 47")).toBeVisible();
    expect(screen.getByRole("button", { name: "Page 5" })).toHaveAttribute("aria-current", "page");
    await user.click(screen.getByRole("button", { name: "Previous" })); expect(screen.getByText("31–40 of 47")).toBeVisible();
  });

  it("omits the range text without a total and page size", () => {
    render(pager(2, 5)); expect(screen.queryByText(/ of 47/)).not.toBeInTheDocument();
  });

  it("gives every control a 44px minimum target", () => {
    render(pager(3, 5));
    for (const button of within(screen.getByRole("navigation", { name: "Test pages" })).getAllByRole("button")) { expect(button).toHaveClass("min-h-11"); expect(button).toHaveClass("min-w-11"); }
  });
});

const template = initialWorkspace.activities[0];
const entries = (count: number, actorOf: (index: number) => ActivityEntry["actor"] = () => "SYSTEM"): ActivityEntry[] => Array.from({ length: count }, (_, index) => ({ ...template, id: `entry-${index + 1}`, actor: actorOf(index), action: `Entry ${String(index + 1).padStart(2, "0")}` }));
const shown = () => screen.getAllByRole("heading", { level: 2, name: /^Entry \d\d$/ }).map((heading) => heading.textContent);
const ledger = () => screen.getByRole("navigation", { name: "Decision ledger pages" });

describe("activity ledger pagination", () => {
  beforeEach(() => { window.HTMLElement.prototype.scrollIntoView = vi.fn(); vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: false }))); });

  it("shows ten entries per page and the rest on the next one", async () => {
    const user = userEvent.setup(); render(<ActivityLedger activities={entries(14)} />);
    expect(shown()).toHaveLength(10); expect(shown()[0]).toBe("Entry 01"); expect(shown()[9]).toBe("Entry 10");
    expect(within(ledger()).getByText("1–10 of 14")).toBeVisible(); expect(within(ledger()).getByRole("button", { name: "Page 1" })).toHaveAttribute("aria-current", "page");
    await user.click(within(ledger()).getByRole("button", { name: "Next" }));
    expect(shown()).toEqual(["Entry 11", "Entry 12", "Entry 13", "Entry 14"]); expect(within(ledger()).getByText("11–14 of 14")).toBeVisible();
    expect(within(ledger()).getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("has no pagination when everything fits on one page", () => {
    render(<ActivityLedger activities={entries(10)} />);
    expect(shown()).toHaveLength(10); expect(screen.queryByRole("navigation", { name: "Decision ledger pages" })).not.toBeInTheDocument();
  });

  it("returns to the first page when the actor filter changes", async () => {
    const user = userEvent.setup(); render(<ActivityLedger activities={entries(23, (index) => index < 12 ? "HUMAN" : "SYSTEM")} />);
    await user.click(within(ledger()).getByRole("button", { name: "Page 3" })); expect(shown()).toHaveLength(3);
    await user.click(screen.getByRole("button", { name: "HUMAN" }));
    expect(shown()).toHaveLength(10); expect(shown()[0]).toBe("Entry 01"); expect(within(ledger()).getByText("1–10 of 12")).toBeVisible();
    await user.click(within(ledger()).getByRole("button", { name: "Next" })); expect(shown()).toEqual(["Entry 11", "Entry 12"]);
    await user.click(screen.getByRole("button", { name: "ALL" })); expect(within(ledger()).getByText("1–10 of 23")).toBeVisible();
  });

  it("clamps the page when the data shrinks", async () => {
    const user = userEvent.setup(); const { rerender } = render(<ActivityLedger activities={entries(23)} />);
    await user.click(within(ledger()).getByRole("button", { name: "Page 3" }));
    rerender(<ActivityLedger activities={entries(12)} />);
    expect(shown()).toEqual(["Entry 11", "Entry 12"]); expect(within(ledger()).getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-current", "page");
    rerender(<ActivityLedger activities={entries(4)} />);
    expect(shown()).toHaveLength(4); expect(screen.queryByRole("navigation", { name: "Decision ledger pages" })).not.toBeInTheDocument();
  });

  it("scrolls the ledger into view when it starts above the viewport and moves focus to the new page", async () => {
    const user = userEvent.setup(); vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: -240 } as DOMRect);
    render(<ActivityLedger activities={entries(14)} />);
    await user.click(within(ledger()).getByRole("button", { name: "Next" }));
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    expect(screen.getByRole("region", { name: "Decision ledger entries, page 2 of 2" })).toHaveFocus();
  });

  it("scrolls without animation for reduced motion", async () => {
    const user = userEvent.setup(); vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: -240 } as DOMRect);
    vi.stubGlobal("matchMedia", vi.fn(() => ({ matches: true })));
    render(<ActivityLedger activities={entries(14)} />);
    await user.click(within(ledger()).getByRole("button", { name: "Next" }));
    expect(window.HTMLElement.prototype.scrollIntoView).toHaveBeenCalledWith({ block: "start", behavior: "auto" });
  });

  it("only moves focus when the top of the ledger is already visible", async () => {
    const user = userEvent.setup(); vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ top: 80 } as DOMRect);
    render(<ActivityLedger activities={entries(14)} />);
    expect(screen.getByRole("region", { name: "Decision ledger entries, page 1 of 2" })).not.toHaveFocus();
    await user.click(within(ledger()).getByRole("button", { name: "Next" }));
    expect(window.HTMLElement.prototype.scrollIntoView).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Decision ledger entries, page 2 of 2" })).toHaveFocus();
  });
});
