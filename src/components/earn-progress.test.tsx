import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { EarnEventDetails, EarnProgress, earnProgress } from "./earn-progress";

const hash = `0x${"a".repeat(64)}`;
const states = (events: { stage: string; hash?: string }[], outcome: Parameters<typeof earnProgress>[2] = "running") => earnProgress("DEPOSIT", events, outcome).steps.map((step) => `${step.key}:${step.state}`);
afterEach(cleanup);

describe("earnProgress", () => {
  it("walks a deposit through approval, signature and receipt from server events only", () => {
    expect(states([])).toEqual(["confirm:active", "approval:waiting", "earn:waiting", "verify:waiting"]);
    expect(states([{ stage: "USER_CONFIRMED" }])).toEqual(["confirm:done", "approval:active", "earn:waiting", "verify:waiting"]);
    expect(states([{ stage: "USER_CONFIRMED" }, { stage: "APPROVAL_SIGNATURE_REQUESTED" }])).toEqual(["confirm:done", "approval:active", "earn:waiting", "verify:waiting"]);
    const approved = [{ stage: "USER_CONFIRMED" }, { stage: "APPROVAL_SIGNATURE_REQUESTED" }, { stage: "TRANSACTION_SUBMITTED", hash }, { stage: "APPROVAL_CONFIRMED", hash }];
    expect(states(approved)).toEqual(["confirm:done", "approval:done", "earn:active", "verify:waiting"]);
    const sent = [...approved, { stage: "EARN_SIGNATURE_REQUESTED" }, { stage: "TRANSACTION_SUBMITTED", hash }];
    expect(states(sent)).toEqual(["confirm:done", "approval:done", "earn:done", "verify:active"]);
    expect(earnProgress("DEPOSIT", sent, "running").caption).toBe("Deposit sent. Verifying the receipt on Arc Testnet.");
    expect(states([...sent, { stage: "COMPLETE", hash }], "done")).toEqual(["confirm:done", "approval:done", "earn:done", "verify:done"]);
  });
  it("tells apart the approval and deposit submissions", () => {
    const progress = earnProgress("DEPOSIT", [{ stage: "USER_CONFIRMED" }, { stage: "APPROVAL_SIGNATURE_REQUESTED" }, { stage: "TRANSACTION_SUBMITTED", hash }], "running");
    expect(progress.steps[1]).toMatchObject({ state: "active", note: "Confirming" });
    expect(progress.caption).toBe("Approval sent. Waiting for Arc Testnet to confirm it.");
  });
  it("marks the approval as not needed when the wallet goes straight to the deposit", () => {
    expect(states([{ stage: "USER_CONFIRMED" }, { stage: "EARN_SIGNATURE_REQUESTED" }])).toEqual(["confirm:done", "approval:skipped", "earn:active", "verify:waiting"]);
  });
  it("has no approval milestone for withdrawals unless the server asks for one", () => {
    expect(earnProgress("WITHDRAW", [{ stage: "USER_CONFIRMED" }, { stage: "EARN_PIN_REQUESTED" }], "running").steps.map((step) => step.key)).toEqual(["confirm", "earn", "verify"]);
  });
  it("stops on the step that failed or became unknown", () => {
    const events = [{ stage: "USER_CONFIRMED" }, { stage: "EARN_SIGNATURE_REQUESTED" }];
    expect(states(events, "failed")).toEqual(["confirm:done", "approval:skipped", "earn:failed", "verify:waiting"]);
    expect(states([...events, { stage: "TRANSACTION_SUBMITTED", hash }], "unknown")).toEqual(["confirm:done", "approval:skipped", "earn:done", "verify:unknown"]);
  });
});

describe("EarnProgress", () => {
  it("announces the current step and marks it for assistive technology", () => {
    render(<EarnProgress operation="DEPOSIT" events={[{ stage: "USER_CONFIRMED" }, { stage: "APPROVAL_SIGNATURE_REQUESTED" }]} outcome="running" />);
    const rail = screen.getByRole("region", { name: "Deposit progress" });
    expect(within(rail).getByText("Step 2 of 4")).toBeInTheDocument();
    expect(within(rail).getByText("Approve USDC spending in your wallet.")).toHaveAttribute("aria-live", "polite");
    expect(within(rail).getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "step");
  });
  it("links the verified receipt once complete", () => {
    render(<EarnProgress operation="DEPOSIT" events={[{ stage: "USER_CONFIRMED" }, { stage: "EARN_SIGNATURE_REQUESTED" }, { stage: "TRANSACTION_SUBMITTED", hash }, { stage: "COMPLETE", hash }]} outcome="done" explorerUrl={`https://testnet.arcscan.app/tx/${hash}`} />);
    expect(screen.getByText("Deposit verified on Arc Testnet.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open transaction/i })).toHaveAttribute("href", `https://testnet.arcscan.app/tx/${hash}`);
  });
  it("keeps every event and hash in collapsible details", () => {
    render(<EarnEventDetails events={[{ stage: "APPROVAL_CONFIRMED", hash }]} />);
    expect(screen.getByText("Approval confirmed")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: hash })).toHaveAttribute("href", `https://testnet.arcscan.app/tx/${hash}`);
  });
});
