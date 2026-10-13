import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MotionGlobalConfig } from "motion/react";
import { AutopilotView } from "./autopilot-view";
import { WalletPreflightError } from "@/lib/wallet/preflight";

const mocks = vi.hoisted(() => ({ signedIn: true, signer: null as null | { sendCalls: ReturnType<typeof vi.fn> }, funding: [] as string[] }));
vi.mock("./treasury-workspace-provider", () => ({ useTreasuryWorkspace: () => ({ signedIn: mocks.signedIn, workspace: { walletConnection: { address: "0x0000000000000000000000000000000000000001", connectedAt: "2026-10-11" } } }) }));
vi.mock("@/lib/wallet/runtime", () => ({ getActiveWalletRuntime: () => mocks.signer, isSignerFor: () => !!mocks.signer }));
const address = "0x0000000000000000000000000000000000000002";
const hash = "0x" + "a".repeat(64);
const decision = { kind: "RETURN_ALL", depositMinor: "0", withdrawMinor: "7969330", transferMinor: "19980000", explanation: "Return everything." };
const run = { id: "run", state: "RUNNING", decision, failure: null, created_at: "2026-10-11T12:00:00Z" };
const initial = () => ({ executionEnabled: true, policyMorphoCapBps: 4000, mode: "ACTIVE", wallet: { address, owner_address: "0x0000000000000000000000000000000000000001", account_type: "EOA" }, mandate: null, spentMinor: "0", returnRequested: false, balances: { cashMinor: "12000000", positionMinor: "7969330", redeemableMinor: "7969330", observedAt: "2026-10-11" }, balanceError: null, runs: [] as typeof run[], steps: [] as { id: string; run_id: string; stage: string; state: string; tx_hash: string | null; circle_transaction_id: string | null }[] });
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
let snapshot = initial();
let handler: (action: string, body: unknown) => Response = () => json({ status: "READY", run });
let requests: { action: string; body: unknown }[];
beforeEach(() => {
  snapshot = initial(); requests = []; mocks.signedIn = true; mocks.signer = null; mocks.funding = [];
  handler = () => json({ status: "READY", run });
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    const action = url.split("/").at(-1)!;
    if (!options?.method) return json(snapshot);
    const body = JSON.parse(String(options.body)); requests.push({ action, body });
    return handler(action, body);
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });
// The progress rail animates its caption; tests read the settled state.
MotionGlobalConfig.skipAnimations = true;
/** The progress rail of a flow ("Invest progress" / "Return progress"). */
const rail = (name: "Invest" | "Return") => screen.getByRole("region", { name: name + " progress" });
async function ready() {
  render(<AutopilotView />);
  await waitFor(() => expect(screen.getByRole("button", { name: "Return everything" })).toBeEnabled());
}
async function tick(ms: number) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function clickReturn() { fireEvent.click(screen.getByRole("button", { name: "Return everything" })); await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm?" })); }); }
async function clickInvest() {
  fireEvent.change(screen.getByLabelText("Amount (USDC)"), { target: { value: "10" } });
  fireEvent.click(screen.getByRole("button", { name: "Invest 10 USDC" }));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirm?" })); });
}
const funding = { status: "READY", agentAddress: address, funding: { call: { to: address, data: "0x1234", value: "0" }, gasBudgetWei: "1000", gasCeiling: { gasLimit: "50", gasPriceWei: "20" }, amountMinor: "10000000" } };
/** invest -> the funding call; funding -> the next queued arrival status (ARRIVED when the queue is empty); anything else -> the run. */
const investing = (next: unknown) => (action: string) => action === "invest" ? json(funding) : action === "funding" ? json({ status: mocks.funding.shift() ?? "ARRIVED" }) : json(next);

describe("one-click Autopilot", () => {
  it("disables both actions when execution is off", async () => {
    snapshot.executionEnabled = false; render(<AutopilotView />);
    expect(await screen.findByText("Autopilot disabled")).toBeVisible();
    expect(screen.getByRole("button", { name: "Invest" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Return everything" })).toBeDisabled();
  });
  it("returns all funds, polls to completion, and links the last receipt", async () => {
    handler = action => {
      if (action === "return-all") snapshot.runs = [run];
      if (action === "status") { snapshot.runs = [{ ...run, state: "COMPLETED" }]; snapshot.steps = [{ id: "step", run_id: run.id, stage: "TRANSFER", state: "VERIFIED", tx_hash: hash, circle_transaction_id: null }]; }
      return json({ status: "READY", run: snapshot.runs[0] });
    };
    await ready(); vi.useFakeTimers(); await clickReturn();
    expect(screen.getByRole("button", { name: "Invest" })).toBeDisabled();
    await tick(3_000);
    expect(rail("Return")).toHaveTextContent("Done. 19.98 USDC sent to your wallet.");
    expect(within(rail("Return")).getByRole("link", { name: /Open transaction/ })).toHaveAttribute("href", "https://testnet.arcscan.app/tx/" + hash);
    expect(requests).toEqual([{ action: "return-all", body: { phase: "now" } }, { action: "status", body: {} }]);
    await tick(9_000); expect(requests).toHaveLength(2);
  });
  it("reports nothing to return for a NO_ACTION decision", async () => {
    handler = () => json({ status: "READY", run: { ...run, state: "NO_ACTION", decision: { ...decision, kind: "NO_ACTION", explanation: "No eligible action." } } });
    await ready(); await clickReturn();
    expect(rail("Return")).toHaveTextContent("Nothing to return.");
    expect(requests).toEqual([{ action: "return-all", body: { phase: "now" } }]);
  });
  it("resumes an UNKNOWN run on page load without starting a new run", async () => {
    snapshot.runs = [{ ...run, state: "UNKNOWN" }]; vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    await act(async () => { render(<AutopilotView />); });
    expect(rail("Return")).toHaveTextContent(/The transaction is uncertain/);
    await tick(3_000); expect(requests.map(item => item.action)).toEqual(["status"]);
  });
  it("retries only rate limits every 30 seconds and stops after six minutes", async () => {
    handler = () => json({ status: "ERROR", code: "AGENT_RATE_LIMIT", message: "Please wait before starting another run." }, 429);
    await ready(); vi.useFakeTimers(); await clickReturn();
    expect(rail("Return")).toHaveTextContent(/Starts in 30s/);
    await tick(29_000); expect(requests).toHaveLength(1);
    await tick(1_000); expect(requests).toHaveLength(2);
    await tick(330_000); expect(requests).toHaveLength(13);
    expect(rail("Return")).toHaveTextContent("Please wait before starting another run.");
    await tick(60_000); expect(requests).toHaveLength(13);
  });
  it("stops pending retries when the page unmounts", async () => {
    handler = () => json({ status: "ERROR", code: "AGENT_RATE_LIMIT", message: "Wait." }, 429);
    await ready(); vi.useFakeTimers(); await clickReturn(); cleanup();
    await tick(60_000); expect(requests).toHaveLength(1);
  });
  it.each(["AGENT_BUDGET_LIMIT", "AGENT_RATE_LIMIT", "FIRST_PARTY_REQUIRED", "AGENT_OWNER_PROOF_REQUIRED", "ERROR"])("shows the server message for an invest %s error, without funding", async code => {
    const sendCalls = vi.fn(); mocks.signer = { sendCalls };
    handler = () => json({ status: "ERROR", code, message: "Cannot prepare your agent yet." }, 400);
    await ready(); await clickInvest();
    expect(rail("Invest")).toHaveTextContent("Cannot prepare your agent yet.");
    expect(rail("Invest")).not.toHaveTextContent(code); expect(screen.queryByRole("alert")).toBeNull();
    expect(sendCalls).not.toHaveBeenCalled(); expect(requests).toHaveLength(1);
  });
  it("signs funding once, waits for success, and starts investing automatically", async () => {
    mocks.signer = { sendCalls: vi.fn().mockResolvedValue(hash) };
    handler = investing({ status: "READY", run: { ...run, decision: { ...decision, kind: "INVEST", withdrawMinor: "0", depositMinor: "4000000", transferMinor: "0" } } });
    await ready(); await clickInvest();
    expect(requests).toEqual([{ action: "invest", body: { amountMinor: "10000000", maxMorphoBps: 4000 } }, { action: "funding", body: { txHash: hash } }, { action: "run", body: {} }]);
    // Signed inside the server's gas ceiling: the browser makes no RPC call of its own before the wallet opens.
    expect(mocks.signer.sendCalls).toHaveBeenCalledExactlyOnceWith([funding.funding.call], "1000", undefined, undefined, funding.funding.gasCeiling);
  });
  it("invests from an agent wallet that has no mandate (and so no balances) yet", async () => {
    mocks.signer = { sendCalls: vi.fn().mockResolvedValue(hash) };
    snapshot = { ...initial(), balances: null } as unknown as typeof snapshot;
    handler = investing({ status: "READY", run: { ...run, decision: { ...decision, kind: "INVEST", withdrawMinor: "0", depositMinor: "4000000", transferMinor: "0" } } });
    render(<AutopilotView />); await waitFor(() => expect(screen.getByRole("button", { name: "Invest" })).toBeEnabled());
    await clickInvest();
    expect(requests.map(item => item.action)).toEqual(["invest", "funding", "run"]); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("does not start a run after wallet cancellation or a reverted receipt", async () => {
    mocks.signer = { sendCalls: vi.fn().mockRejectedValue({ cause: { code: 4001, message: "User rejected" } }) };
    handler = () => json(funding); await ready(); await clickInvest();
    expect(rail("Invest")).toHaveTextContent("Cancelled in your wallet. Nothing was sent.");
    expect(requests.map(item => item.action)).toEqual(["invest"]);
    mocks.signer.sendCalls.mockResolvedValue(hash); mocks.funding = ["REVERTED"]; handler = investing({ status: "READY", run });
    await clickInvest(); expect(rail("Invest")).toHaveTextContent("The funding transfer reverted");
    expect(requests.map(item => item.action)).toEqual(["invest", "invest", "funding"]);
  });
  it("waits on the server until the transfer arrives, then starts the agent once", async () => {
    mocks.signer = { sendCalls: vi.fn().mockResolvedValue(hash) }; mocks.funding = ["PENDING", "PENDING"]; handler = investing({ status: "READY", run });
    await ready(); vi.useFakeTimers(); await clickInvest();
    expect(within(rail("Invest")).getByRole("link", { name: /View transfer/ })).toHaveAttribute("href", "https://testnet.arcscan.app/tx/" + hash);
    expect(requests.map(item => item.action)).toEqual(["invest", "funding"]);
    await tick(2_000); expect(requests.map(item => item.action)).toEqual(["invest", "funding", "funding"]);
    await tick(2_000); expect(requests.map(item => item.action)).toEqual(["invest", "funding", "funding", "funding", "run"]);
  });
  it("explains a wallet that could not prepare the transfer without starting anything", async () => {
    mocks.signer = { sendCalls: vi.fn().mockRejectedValue(new WalletPreflightError("WALLET_SESSION_CHANGED", "changed")) }; handler = investing({ status: "READY", run });
    await ready(); await clickInvest();
    expect(rail("Invest")).toHaveTextContent("Your wallet switched account or network"); expect(requests.map(item => item.action)).toEqual(["invest"]);
  });
  it("automatically continues manual funding only after the requested cash arrives", async () => {
    handler = action => action === "invest" ? json(funding) : json({ status: "READY", run });
    await ready(); vi.useFakeTimers(); await clickInvest();
    expect(screen.getByRole("alert")).toHaveTextContent("Reconnect your wallet to sign the funding transfer");
    expect(screen.getByLabelText("Agent funding address")).toHaveValue(address);
    snapshot.balances.cashMinor = "12000001"; await tick(3_000);
    expect(requests.map(item => item.action)).toEqual(["invest"]);
    snapshot.balances.cashMinor = "22000000"; await tick(3_000);
    expect(requests.map(item => item.action)).toEqual(["invest", "run"]);
  });
});
describe("AI advisor", () => {
  const mandate = { budgetMinor: "50000000", reserveMinor: "0", maxPerRunMinor: "50000000", maxMorphoBps: 4000, enabled: true, paused: false };
  it("shows why the advisor changed a run, what triggered it and what the engine had proposed", async () => {
    const advised = { ...run, state: "COMPLETED", snapshot: { trigger: "BILL_PROTECTION" }, decision: { kind: "INVEST", depositMinor: "4000000", withdrawMinor: "0", transferMinor: "0", remainingBudgetMinor: "0", protectedMinor: "0", explanation: "Advisor: A bill is due in two days; invest less.", advisor: { status: "APPLIED", action: "REDUCE", provider: "GROQ", model: "openai/gpt-oss-120b", rationale: "A bill is due in two days; invest less.", engine: { kind: "INVEST", depositMinor: "10000000", withdrawMinor: "0", transferMinor: "0", explanation: "Invest only arrived agent cash." } } } };
    snapshot = { ...initial(), runs: [advised as unknown as typeof run] };
    await ready();
    fireEvent.click(screen.getByText("History"));
    expect(screen.getByText("Advisor adjusted")).toBeInTheDocument();
    expect(screen.getByText("A bill entered its protection window")).toBeInTheDocument();
    expect(screen.getByText("A bill is due in two days; invest less.")).toBeInTheDocument();
    expect(screen.getByText(/Engine proposed: invested in morpho 10 USDC/)).toBeInTheDocument();
  });
  it("shows the advisor as always on once the operator enables it, with no switch to turn", async () => {
    snapshot = { ...initial(), mandate, advisor: { available: true, model: "openai/gpt-oss-120b" } } as unknown as ReturnType<typeof initial>;
    await ready();
    fireEvent.click(screen.getByText("Settings"));
    expect(screen.getByText("Always on, openai/gpt-oss-120b on Groq")).toBeInTheDocument();
    expect(screen.queryByRole("switch", { name: "AI advisor" })).toBeNull();
  });
  it("says so while the operator has not enabled the advisor", async () => {
    snapshot = { ...initial(), mandate, advisor: { available: false, model: null } } as unknown as ReturnType<typeof initial>;
    await ready();
    fireEvent.click(screen.getByText("Settings"));
    expect(screen.getByText("Not enabled by the operator yet")).toBeInTheDocument();
  });
});
