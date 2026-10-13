import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CONFIRM_WINDOW_MS, ConfirmButton } from "./confirm-button";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("ConfirmButton", () => {
  it("asks once, then runs on the second press", () => {
    const run = vi.fn();
    render(<ConfirmButton onClick={run}>Return everything</ConfirmButton>);
    fireEvent.click(screen.getByRole("button", { name: "Return everything" }));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Confirm?" })).toHaveAttribute("data-armed", "true");
    expect(screen.getByText("Press again to confirm.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Confirm?" }));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Return everything" })).not.toHaveAttribute("data-armed");
  });

  it("goes back to its label after six seconds, on blur and on Escape", () => {
    vi.useFakeTimers();
    const run = vi.fn();
    render(<ConfirmButton onClick={run}>Deposit</ConfirmButton>);
    const button = screen.getByRole("button");
    fireEvent.click(button);
    act(() => { vi.advanceTimersByTime(CONFIRM_WINDOW_MS); });
    expect(button).toHaveTextContent("Deposit");
    fireEvent.click(button); fireEvent.blur(button);
    expect(button).toHaveTextContent("Deposit");
    fireEvent.click(button); fireEvent.keyDown(button, { key: "Escape" });
    expect(button).toHaveTextContent("Deposit");
    expect(run).not.toHaveBeenCalled();
  });

  it("submits its form only on the second press", () => {
    const submit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());
    render(<form onSubmit={submit}><ConfirmButton type="submit">Invest 10 USDC</ConfirmButton></form>);
    fireEvent.click(screen.getByRole("button", { name: "Invest 10 USDC" }));
    expect(submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Confirm?" }));
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("never shows Confirm? while disabled", () => {
    const { rerender } = render(<ConfirmButton>Withdraw all</ConfirmButton>);
    fireEvent.click(screen.getByRole("button"));
    rerender(<ConfirmButton disabled>Withdraw all</ConfirmButton>);
    expect(screen.getByRole("button", { name: "Withdraw all" })).toBeDisabled();
  });
});
