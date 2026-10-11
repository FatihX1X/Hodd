import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { AutopilotProgress, autopilotProgress, type AutopilotProgressInput } from "./autopilot-progress";

const hash = `0x${"b".repeat(64)}`;
const other = `0x${"c".repeat(64)}`;
const tx = (hash: string) => `https://testnet.arcscan.app/tx/${hash}`;
const step = (stage: string, state: string, tx_hash: string | null = null) => ({ stage, state, tx_hash });
type Run = NonNullable<AutopilotProgressInput["run"]>;
const run = (state: Run["state"], decision: Partial<Run["decision"]> = {}, failure: string | null = null): Run => ({ state, failure, decision: { kind: "INVEST", depositMinor: "10000000", withdrawMinor: "0", transferMinor: "0", explanation: "Nothing needs to move.", ...decision } });
const giveBack = (state: Run["state"], decision: Partial<Run["decision"]> = {}, failure: string | null = null) => run(state, { kind: "RETURN_ALL", withdrawMinor: "5000000", transferMinor: "19970000", ...decision }, failure);
const base: AutopilotProgressInput = { flow: "invest", local: null, run: null, steps: [], error: null, countdown: null, result: null, fundingHash: null };
const view = (input: Partial<AutopilotProgressInput>) => autopilotProgress({ ...base, ...input });
const states = (input: Partial<AutopilotProgressInput>) => view(input).steps.map((item) => `${item.key}:${item.state}`);
const back = (input: Partial<AutopilotProgressInput>) => view({ flow: "return", ...input });
afterEach(cleanup);

describe("autopilotProgress for Invest", () => {
  it("walks the client phases before a run exists", () => {
    expect(states({ local: "preparing" })).toEqual(["prepare:active", "fund:waiting", "approve:waiting", "deposit:waiting", "done:waiting"]);
    expect(states({})).toEqual(states({ local: "preparing" }));
    const wallet = view({ local: "wallet" });
    expect(states({ local: "wallet" })).toEqual(["prepare:done", "fund:active", "approve:waiting", "deposit:waiting", "done:waiting"]);
    expect(wallet.steps[1].note).toBe("In your wallet");
    expect(wallet.caption).toBe("Confirm the transfer in your wallet.");
    const funding = view({ local: "funding" });
    expect(funding.steps[1]).toMatchObject({ state: "active", note: "Arriving" });
    expect(funding.caption).toBe("Your USDC is on its way to the agent.");
    expect(states({ local: "starting" })).toEqual(["prepare:done", "fund:done", "approve:active", "deposit:waiting", "done:waiting"]);
    expect(view({ local: "starting" }).caption).toBe("Your agent is starting.");
    expect(view({ local: "preparing" }).caption).toBe("Setting up your agent.");
    expect(view({ local: "preparing" })).toMatchObject({ active: 0, outcome: "running", label: "Invest progress" });
  });
  it("counts down to the automatic retry on the next step", () => {
    const cooling = view({ local: "cooldown", countdown: 27 });
    expect(states({ local: "cooldown", countdown: 27 })).toEqual(["prepare:done", "fund:done", "approve:active", "deposit:waiting", "done:waiting"]);
    expect(cooling.steps[2].note).toBe("Starts in 27s");
    expect(cooling.caption).toBe("Hodd allows one run every few minutes. Trying again automatically.");
    expect(view({ local: "cooldown", countdown: null }).steps[2].note).toBe("Starts soon");
  });
  it("links the owner's funding transfer only while it is arriving", () => {
    expect(view({ local: "funding", fundingHash: hash }).link).toEqual({ href: tx(hash), text: "View transfer" });
    expect(view({ local: "wallet", fundingHash: hash }).link).toBeNull();
    expect(view({ local: "funding" }).link).toBeNull();
    expect(view({ local: null, run: run("RUNNING"), fundingHash: hash }).link).toBeNull();
  });
  it("follows the run's approval and deposit steps", () => {
    expect(states({ run: run("RUNNING") })).toEqual(["prepare:done", "fund:done", "approve:active", "deposit:waiting", "done:waiting"]);
    expect(view({ run: run("RUNNING") }).caption).toBe("The agent is preparing the deposit.");
    const sending = view({ run: run("RUNNING"), steps: [step("APPROVAL", "PREPARED")] });
    expect(sending.steps[2]).toMatchObject({ state: "active", note: "Sending" });
    expect(sending.caption).toBe("The agent is approving USDC for Morpho.");
    expect(view({ run: run("RUNNING"), steps: [step("APPROVAL", "SUBMITTING")] }).steps[2].note).toBe("Sending");
    expect(view({ run: run("RUNNING"), steps: [step("APPROVAL", "SUBMITTED", hash)] }).steps[2]).toMatchObject({ state: "active", note: "Confirming" });
    const approved = [step("APPROVAL", "VERIFIED", hash)];
    const preparing = view({ run: run("RUNNING"), steps: approved });
    expect(states({ run: run("RUNNING"), steps: approved })).toEqual(["prepare:done", "fund:done", "approve:done", "deposit:active", "done:waiting"]);
    expect(preparing.steps[3].note).toBe("Preparing");
    expect(preparing.caption).toBe("The agent is depositing into Morpho.");
    expect(view({ run: run("RUNNING"), steps: [...approved, step("EARN", "SUBMITTED", other)] }).steps[3]).toMatchObject({ state: "active", note: "Confirming" });
    const deposited = view({ run: run("RUNNING"), steps: [...approved, step("EARN", "VERIFIED", other)] });
    expect(deposited.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["prepare:done", "fund:done", "approve:done", "deposit:done", "done:active"]);
    expect(deposited.steps[4].note).toBe("Finishing");
    expect(deposited.caption).toBe("Deposit confirmed. Finishing up.");
    expect(deposited.link).toBeNull();
  });
  it("marks the approval as not needed when the run goes straight to the deposit", () => {
    const sent = view({ run: run("RUNNING"), steps: [step("EARN", "PREPARED")] });
    expect(sent.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["prepare:done", "fund:done", "approve:skipped", "deposit:active", "done:waiting"]);
    expect(sent.steps[2].note).toBe("Not needed");
  });
  it("finishes with a check, the view's sentence and a link to the last transaction", () => {
    const done = view({ run: run("COMPLETED"), steps: [step("APPROVAL", "VERIFIED", hash), step("EARN", "VERIFIED", other)], result: "Done. 6.00 USDC in Morpho, 4.00 USDC ready as cash." });
    expect(done.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["prepare:done", "fund:done", "approve:done", "deposit:done", "done:done"]);
    expect(done).toMatchObject({ outcome: "done", active: 4, caption: "Done. 6.00 USDC in Morpho, 4.00 USDC ready as cash.", link: { href: tx(other), text: "Open transaction" } });
    const noApproval = view({ run: run("COMPLETED"), steps: [step("EARN", "VERIFIED", other)] });
    expect(noApproval.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["prepare:done", "fund:done", "approve:skipped", "deposit:done", "done:done"]);
    expect(noApproval.caption).toBe("Your USDC is invested.");
    expect(view({ run: run("COMPLETED"), steps: [] }).steps.map((item) => item.state)).toEqual(["done", "done", "skipped", "skipped", "done"]);
    expect(view({ run: run("COMPLETED"), steps: [] }).link).toBeNull();
  });
  it("ends calmly when there is nothing to do", () => {
    const calm = view({ run: run("NO_ACTION", { kind: "NO_ACTION", explanation: "Your cash is already at the target." }), steps: [] });
    expect(calm.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["prepare:done", "fund:done", "approve:skipped", "deposit:skipped", "done:skipped"]);
    expect(calm).toMatchObject({ outcome: "idle", active: 1, caption: "Your cash is already at the target.", link: null });
    expect(view({ run: run("NO_ACTION"), result: "Nothing to invest." }).caption).toBe("Nothing to invest.");
  });
  it("stops on the step that failed, became unknown or was halted", () => {
    const approvalFailed = view({ run: run("FAILED", {}, "AGENT_PAUSED"), steps: [step("APPROVAL", "FAILED")], result: "Stopped because Autopilot is switched off. Nothing else was sent." });
    expect(approvalFailed.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["prepare:done", "fund:done", "approve:failed", "deposit:waiting", "done:waiting"]);
    expect(approvalFailed).toMatchObject({ outcome: "failed", active: 2, caption: "Stopped because Autopilot is switched off. Nothing else was sent." });
    expect(approvalFailed.steps.slice(3).map((item) => item.note)).toEqual(["Not run", "Not run"]);
    const refused = view({ run: run("FAILED", {}, "AGENT_FRESH_POLICY_BLOCKED") });
    expect(refused.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["prepare:done", "fund:done", "approve:failed", "deposit:waiting", "done:waiting"]);
    expect(refused.caption).toBe("Stopped here. Nothing else is sent from this run.");
    const depositHalted = view({ run: run("FAILED"), steps: [step("APPROVAL", "VERIFIED", hash), step("EARN", "SUBMITTED", other)] });
    expect(depositHalted.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["prepare:done", "fund:done", "approve:done", "deposit:failed", "done:waiting"]);
    expect(depositHalted.steps[3].note).toBe("Stopped");
    const partial = view({ run: run("PARTIAL"), steps: [step("EARN", "VERIFIED", other)], result: "Most of your USDC is back." });
    expect(partial).toMatchObject({ outcome: "failed", active: 4, caption: "Most of your USDC is back." });
    expect(partial.steps[4]).toMatchObject({ state: "failed", note: "Stopped" });
    expect(view({ run: run("RUNNING"), steps: [step("EARN", "FAILED")] })).toMatchObject({ outcome: "failed", active: 3 });
  });
  it("turns amber when the outcome is unknown", () => {
    const sent = view({ run: run("UNKNOWN"), steps: [step("APPROVAL", "VERIFIED", hash), step("EARN", "UNKNOWN", other)] });
    expect(sent.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["prepare:done", "fund:done", "approve:done", "deposit:unknown", "done:waiting"]);
    expect(sent).toMatchObject({ outcome: "unknown", active: 3, caption: "The transaction is uncertain. Hodd is checking it; use recovery below if needed." });
    expect(view({ run: run("UNKNOWN"), steps: [step("APPROVAL", "SUBMITTED", hash)] }).steps[2]).toMatchObject({ state: "unknown", note: "Unknown" });
    expect(view({ run: run("RUNNING"), steps: [step("APPROVAL", "UNKNOWN")] }).outcome).toBe("unknown");
    expect(view({ run: run("UNKNOWN"), steps: [], result: "Checking." }).caption).toBe("Checking.");
  });
  it("stops on the local step when something goes wrong before a run exists", () => {
    const cancelled = view({ local: "wallet", error: "Cancelled in your wallet. Nothing was sent." });
    expect(cancelled.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["prepare:done", "fund:failed", "approve:waiting", "deposit:waiting", "done:waiting"]);
    expect(cancelled).toMatchObject({ outcome: "failed", active: 1, caption: "Cancelled in your wallet. Nothing was sent." });
    expect(cancelled.steps[1].note).toBe("Stopped");
    expect(states({ local: "funding", error: "The funding transfer reverted." })).toEqual(["prepare:done", "fund:failed", "approve:waiting", "deposit:waiting", "done:waiting"]);
    expect(states({ local: "preparing", error: "Choose a Morpho share within your policy limit." })[0]).toBe("prepare:failed");
    expect(states({ local: "starting", error: "Run refused." })[2]).toBe("approve:failed");
    expect(states({ local: null, error: "No wallet." })[0]).toBe("prepare:failed");
  });
  it("lets the run, not an old error, decide once it exists", () => {
    expect(view({ run: run("RUNNING"), steps: [step("APPROVAL", "PREPARED")], error: "Stale message." })).toMatchObject({ outcome: "running", active: 2 });
  });
});

describe("autopilotProgress for Return", () => {
  it("has four milestones and starts with the preparation", () => {
    const start = back({ local: "preparing" });
    expect(start.steps.map((item) => item.key)).toEqual(["start", "withdraw", "send", "done"]);
    expect(start).toMatchObject({ active: 0, outcome: "running", caption: "Preparing your return.", label: "Return progress" });
    expect(start.steps[0]).toMatchObject({ state: "active", note: "Preparing" });
    expect(states({ flow: "return", local: "preparing" })).toEqual(["start:active", "withdraw:waiting", "send:waiting", "done:waiting"]);
    expect(back({ local: "starting" }).steps[0].note).toBe("Starting");
  });
  it("counts down to the automatic retry on the first step", () => {
    const cooling = back({ local: "cooldown", countdown: 12 });
    expect(cooling.steps[0]).toMatchObject({ state: "active", note: "Starts in 12s" });
    expect(cooling.caption).toBe("Hodd allows one run every few minutes. Trying again automatically.");
  });
  it("follows the withdrawal and the transfer", () => {
    const fresh = back({ run: giveBack("RUNNING") });
    expect(fresh.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["start:done", "withdraw:active", "send:waiting", "done:waiting"]);
    expect(fresh.steps[1].note).toBe("Preparing");
    expect(fresh.caption).toBe("Withdrawing your Morpho position.");
    expect(back({ run: giveBack("RUNNING"), steps: [step("APPROVAL", "SUBMITTED", hash)] }).steps[1]).toMatchObject({ state: "active", note: "Confirming" });
    expect(back({ run: giveBack("RUNNING"), steps: [step("APPROVAL", "VERIFIED", hash)] }).steps[1]).toMatchObject({ state: "active", note: "Preparing" });
    expect(back({ run: giveBack("RUNNING"), steps: [step("APPROVAL", "VERIFIED", hash), step("EARN", "PREPARED")] }).steps[1]).toMatchObject({ state: "active", note: "Sending" });
    const withdrawn = back({ run: giveBack("RUNNING"), steps: [step("EARN", "VERIFIED", hash)] });
    expect(withdrawn.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["start:done", "withdraw:done", "send:active", "done:waiting"]);
    expect(withdrawn.caption).toBe("Sending USDC to your wallet.");
    const sending = back({ run: giveBack("RUNNING"), steps: [step("EARN", "VERIFIED", hash), step("TRANSFER", "SUBMITTED", other)] });
    expect(sending.steps[2]).toMatchObject({ state: "active", note: "Confirming" });
    const sent = back({ run: giveBack("RUNNING"), steps: [step("EARN", "VERIFIED", hash), step("TRANSFER", "VERIFIED", other)] });
    expect(sent.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["start:done", "withdraw:done", "send:done", "done:active"]);
    expect(sent.caption).toBe("USDC sent. Finishing up.");
  });
  it("skips the withdrawal for a cash-only return", () => {
    const cash = back({ run: giveBack("RUNNING", { withdrawMinor: "0" }) });
    expect(cash.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["start:done", "withdraw:skipped", "send:active", "done:waiting"]);
    expect(cash.steps[1].note).toBe("Nothing in Morpho");
    expect(cash.caption).toBe("Sending USDC to your wallet.");
    const finished = back({ run: giveBack("COMPLETED", { withdrawMinor: "0" }), steps: [step("TRANSFER", "VERIFIED", other)], result: "Done. 19.97 USDC sent to your wallet." });
    expect(finished.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["start:done", "withdraw:skipped", "send:done", "done:done"]);
    expect(finished).toMatchObject({ outcome: "done", active: 3, caption: "Done. 19.97 USDC sent to your wallet.", link: { href: tx(other), text: "Open transaction" } });
  });
  it("finishes after a withdrawal and a transfer", () => {
    const finished = back({ run: giveBack("COMPLETED"), steps: [step("APPROVAL", "VERIFIED", hash), step("EARN", "VERIFIED", hash), step("TRANSFER", "VERIFIED", other)] });
    expect(finished.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["start:done", "withdraw:done", "send:done", "done:done"]);
    expect(finished.caption).toBe("Your USDC is back in your wallet.");
    expect(finished.link?.href).toBe(tx(other));
  });
  it("ends calmly when there is nothing to return", () => {
    const calm = back({ run: giveBack("NO_ACTION", { kind: "NO_ACTION", withdrawMinor: "0", transferMinor: "0", explanation: "The agent holds nothing." }), result: "Nothing to return." });
    expect(calm.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["start:done", "withdraw:skipped", "send:skipped", "done:skipped"]);
    expect(calm).toMatchObject({ outcome: "idle", active: 0, caption: "Nothing to return." });
    expect(back({ run: giveBack("NO_ACTION", { withdrawMinor: "0", explanation: "The agent holds nothing." }) }).caption).toBe("The agent holds nothing.");
  });
  it("stops on the withdrawal or the transfer, and turns amber when unknown", () => {
    const withdrawalFailed = back({ run: giveBack("FAILED", {}, "AGENT_QUOTE_EXPIRED"), steps: [step("EARN", "FAILED")], result: "The quote expired before signing. Nothing was sent; try again." });
    expect(withdrawalFailed.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["start:done", "withdraw:failed", "send:waiting", "done:waiting"]);
    expect(withdrawalFailed).toMatchObject({ outcome: "failed", active: 1, caption: "The quote expired before signing. Nothing was sent; try again." });
    const residual = back({ run: giveBack("PARTIAL", {}, "AGENT_RETURN_HAS_RESIDUAL_ASSETS"), steps: [step("EARN", "VERIFIED", hash), step("TRANSFER", "VERIFIED", other)] });
    expect(residual).toMatchObject({ outcome: "failed", active: 3 });
    const unknown = back({ run: giveBack("UNKNOWN"), steps: [step("EARN", "VERIFIED", hash), step("TRANSFER", "UNKNOWN", other)] });
    expect(unknown.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["start:done", "withdraw:done", "send:unknown", "done:waiting"]);
    expect(unknown).toMatchObject({ outcome: "unknown", active: 2 });
  });
  it("stops on the first step when the return cannot start", () => {
    const refused = back({ local: "preparing", error: "Autopilot is switched off." });
    expect(refused.steps.map((item) => `${item.key}:${item.state}`)).toEqual(["start:failed", "withdraw:waiting", "send:waiting", "done:waiting"]);
    expect(refused).toMatchObject({ outcome: "failed", active: 0, caption: "Autopilot is switched off." });
  });
});

describe("AutopilotProgress", () => {
  it("shows every milestone and marks the active one for assistive technology", () => {
    render(<AutopilotProgress input={{ ...base, local: "wallet" }} />);
    const rail = screen.getByRole("region", { name: "Invest progress" });
    const items = within(rail).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual(["PrepareReady, done", "Fund agentIn your wallet, in progress", "ApproveNext, not started", "DepositLater, not started", "DoneLast, not started"]);
    expect(items.map((item) => item.getAttribute("aria-current"))).toEqual([null, "step", null, null, null]);
    expect(within(rail).getByText("Step 2 of 5")).toBeInTheDocument();
    expect(within(rail).getByText("Confirm the transfer in your wallet.")).toHaveAttribute("aria-live", "polite");
  });
  it("describes the return with four milestones", () => {
    render(<AutopilotProgress input={{ ...base, flow: "return", run: giveBack("RUNNING"), steps: [step("EARN", "SUBMITTED", hash)] }} />);
    const rail = screen.getByRole("region", { name: "Return progress" });
    expect(within(rail).getAllByRole("listitem").map((item) => item.getAttribute("aria-current"))).toEqual([null, "step", null, null]);
    expect(within(rail).getByText("Step 2 of 4")).toBeInTheDocument();
    expect(within(rail).getByText("Withdraw")).toBeInTheDocument();
    expect(within(rail).getByText("Confirming")).toBeInTheDocument();
  });
  it("links the last transaction once finished", () => {
    render(<AutopilotProgress input={{ ...base, run: run("COMPLETED"), steps: [step("APPROVAL", "VERIFIED", hash), step("EARN", "VERIFIED", other)], result: "Done." }} />);
    const rail = screen.getByRole("region", { name: "Invest progress" });
    expect(within(rail).getByText("Done.")).toBeInTheDocument();
    expect(within(rail).getByRole("link", { name: /open transaction/i })).toHaveAttribute("href", tx(other));
    expect(within(rail).getAllByRole("listitem").every((item) => !item.hasAttribute("aria-current"))).toBe(true);
  });
  it("links the funding transfer while it arrives", () => {
    render(<AutopilotProgress input={{ ...base, local: "funding", fundingHash: hash }} />);
    expect(screen.getByRole("link", { name: /view transfer/i })).toHaveAttribute("href", tx(hash));
    expect(screen.getByText("Your USDC is on its way to the agent.")).toBeInTheDocument();
  });
  it("says nothing is left to do instead of counting steps", () => {
    render(<AutopilotProgress input={{ ...base, flow: "return", run: giveBack("NO_ACTION", { withdrawMinor: "0", transferMinor: "0", explanation: "The agent holds nothing." }), result: "Nothing to return." }} />);
    expect(screen.getByText("Nothing to do")).toBeInTheDocument();
    expect(screen.getByText("Nothing to return.")).toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });
  it("shows the failure on the stopped step", () => {
    render(<AutopilotProgress input={{ ...base, local: "wallet", error: "Cancelled in your wallet. Nothing was sent." }} />);
    const rail = screen.getByRole("region", { name: "Invest progress" });
    expect(within(rail).getAllByRole("listitem")[1]).toHaveTextContent("Fund agentStopped, stopped");
    expect(within(rail).getAllByRole("listitem")[1]).toHaveAttribute("aria-current", "step");
    expect(within(rail).getByText("Cancelled in your wallet. Nothing was sent.")).toBeInTheDocument();
  });
});
