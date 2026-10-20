import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { UsycPosition, UsycQuote, UsycStatusResponse } from "@/lib/usyc/models";
import { UsycPoolCard, usycProgress } from "./usyc-pool-card";

const fake = vi.hoisted(() => ({ runtime: vi.fn(), send: vi.fn(), activity: vi.fn(), refreshUsyc: vi.fn(), refreshWallet: vi.fn(), state: null as unknown }));
const wallet = "0x93A7F9a958171303DE74Ab7f6778D25F96316564";
const pool = "0x4F1E3B1c0A9D8E7f6a5B4C3D2E1f0A9b8C7d6E5f";
const usdc = "0x3600000000000000000000000000000000000000";
const hash = (digit: string) => `0x${digit.repeat(64)}`;
vi.mock("./treasury-workspace-provider", () => ({ useTreasuryWorkspace: () => ({ workspace: { walletConnection: { address: wallet, connectedAt: "session" } }, usycState: fake.state, readOnly: false, refreshUsyc: fake.refreshUsyc, refreshWallet: fake.refreshWallet, recordEarnActivity: fake.activity }) }));
vi.mock("@/lib/wallet/runtime", async (original) => ({ ...(await original<typeof import("@/lib/wallet/runtime")>()), getActiveWalletRuntime: fake.runtime, peekActiveWalletRuntime: () => fake.runtime() }));

const position: UsycPosition = { wallet, pool, circle: "OK", depositsPaused: false, maxDepositUsdc: "1000000000", shares: "8000000000000", usycMinor: "7999999", valueUsdc: "9117958", maxWithdrawShares: "8000000000000", maxWithdrawUsdc: "9117958", priceUsdcPerUsyc: "1139744957475496722", subscribePriceUsdcPerUsyc: "1139744957475496722", afterHoursPricing: false, observedAt: "2026-10-13T10:00:00.000Z" };
const ready = (patch: Partial<UsycStatusResponse> = {}, positionPatch: Partial<UsycPosition> = {}) => { fake.state = { status: "READY", data: { status: "READY", position: { ...position, ...positionPatch }, executionEnabled: true, executionNote: null, walletCanSign: true, ...patch } }; };
const step = (stage: "APPROVE" | "DEPOSIT" | "WITHDRAW", to: string, data: string) => ({ stage, call: { to, data, value: "0" as const }, gasBudgetWei: "9600000000000000", gasCeiling: { gasLimit: "46447", gasPriceWei: "50000000000" } });
const depositQuote: UsycQuote = { kind: "DEPOSIT", wallet, amountMinor: "5000000", steps: [step("APPROVE", usdc, "0x095ea7b3"), step("DEPOSIT", pool, "0x6e553f65")], preview: { usdcMinor: "5000000", shares: "4385000000000", minimum: "4363075000000", afterHoursPricing: false }, networkFeeMinor: "22183", gasSimulated: true, observedAt: "2026-10-13T10:00:00.000Z" };
const withdrawQuote: UsycQuote = { kind: "WITHDRAW", wallet, amountMinor: "8000000000000", steps: [step("WITHDRAW", pool, "0xba087652")], preview: { usdcMinor: "9117958", shares: "8000000000000", minimum: "9072368", afterHoursPricing: false }, networkFeeMinor: "12660", gasSimulated: true, observedAt: "2026-10-13T10:00:00.000Z" };
function serve(responses: { ok?: boolean; body: unknown }[]) {
  const fetcher = vi.fn(async (...args: [string, RequestInit]) => { void args; const next = responses.shift(); if (!next) throw new Error("unexpected request"); return { ok: next.ok ?? true, json: async () => next.body }; });
  vi.stubGlobal("fetch", fetcher); return fetcher;
}
const sent = (fetcher: ReturnType<typeof serve>) => fetcher.mock.calls.map(([, init]) => JSON.parse(init.body as string));

beforeEach(() => {
  vi.clearAllMocks(); ready();
  fake.runtime.mockReturnValue({ connection: { address: wallet, connectedAt: "session" }, sendCalls: fake.send });
  fake.send.mockResolvedValueOnce(hash("1")).mockResolvedValueOnce(hash("2"));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("UsycPoolCard", () => {
  it("prefills the amount from a Claude request link and the notice, without sending anything", async () => {
    const fetcher = serve([]); const scroll = vi.fn(); Element.prototype.scrollIntoView = scroll;
    window.history.pushState({}, "", "/invest?usyc=deposit&amount=125.5&request=abc");
    render(<UsycPoolCard />);
    expect(await screen.findByText(/Claude asked you to: Deposit 125.5 USDC/)).toBeInTheDocument();
    expect(screen.getByLabelText("USYC pool amount")).toHaveValue("125.5"); expect(scroll).toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled(); expect(fake.send).not.toHaveBeenCalled();
    window.history.pushState({}, "", "/");
  });
  it("ignores a bad amount and leaves the withdraw-all form empty", async () => {
    serve([]); Element.prototype.scrollIntoView = vi.fn();
    window.history.pushState({}, "", "/invest?usyc=withdraw-all&amount=9");
    render(<UsycPoolCard />);
    expect(await screen.findByText(/Claude asked you to: Withdraw all./)).toBeInTheDocument();
    expect(screen.getByLabelText("USYC pool amount")).toHaveValue("");
    window.history.pushState({}, "", "/");
  });
  it("deposits in one click: exact approval, then the deposit, each verified on the server before the next", async () => {
    const fetcher = serve([
      { body: { status: "READY", quote: depositQuote } },
      { body: { status: "CONFIRMED", step: "APPROVE", txHash: hash("1") } },
      { body: { status: "CONFIRMED", step: "DEPOSIT", txHash: hash("2"), depositedUsdcMinor: "5000000", receivedShares: "4385000000000" } },
    ]);
    render(<UsycPoolCard />);
    await userEvent.type(screen.getByLabelText("USYC pool amount"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Deposit" })); await userEvent.click(screen.getByRole("button", { name: "Confirm?" }));
    expect(await screen.findByText(/Deposit verified on Arc Testnet/)).toBeInTheDocument();
    expect(sent(fetcher)).toEqual([
      { action: "QUOTE_DEPOSIT", amountMinor: "5000000" },
      { action: "VERIFY", step: "APPROVE", txHash: hash("1"), amountMinor: "5000000" },
      { action: "VERIFY", step: "DEPOSIT", txHash: hash("2"), amountMinor: "5000000" },
    ]);
    // Each step goes to the wallet alone, with the server's own gas ceiling.
    expect(fake.send).toHaveBeenNthCalledWith(1, [{ to: usdc, data: "0x095ea7b3", value: "0" }], "9600000000000000", undefined, undefined, { gasLimit: "46447", gasPriceWei: "50000000000" });
    expect(fake.send).toHaveBeenNthCalledWith(2, [{ to: pool, data: "0x6e553f65", value: "0" }], "9600000000000000", undefined, undefined, { gasLimit: "46447", gasPriceWei: "50000000000" });
    expect(fake.activity).toHaveBeenCalledWith("USYC pool deposit confirmed", expect.stringContaining("5.000000"), expect.any(String));
    expect(fake.refreshUsyc).toHaveBeenCalled(); expect(fake.refreshWallet).toHaveBeenCalled();
    expect(screen.getByRole("link", { name: /open transaction/i })).toHaveAttribute("href", `https://testnet.arcscan.app/tx/${hash("2")}`);
  });

  it("withdraws everything in one click and says how much USDC came back", async () => {
    const fetcher = serve([
      { body: { status: "READY", quote: withdrawQuote } },
      { body: { status: "CONFIRMED", step: "WITHDRAW", txHash: hash("1"), burnedShares: "8000000000000", receivedUsdcMinor: "9117958" } },
    ]);
    render(<UsycPoolCard />);
    await userEvent.click(screen.getByRole("button", { name: "Withdraw all" })); await userEvent.click(screen.getByRole("button", { name: "Confirm?" }));
    expect(await screen.findByText(/9\.117958 USDC is back in your wallet/)).toBeInTheDocument();
    expect(sent(fetcher)).toEqual([{ action: "QUOTE_WITHDRAW", all: true }, { action: "VERIFY", step: "WITHDRAW", txHash: hash("1"), amountMinor: "8000000000000" }]);
    expect(fake.send).toHaveBeenCalledTimes(1);
  });

  it("waits for a pending receipt instead of guessing", async () => {
    serve([
      { body: { status: "READY", quote: withdrawQuote } },
      { body: { status: "PENDING", step: "WITHDRAW", txHash: hash("1") } },
      { body: { status: "CONFIRMED", step: "WITHDRAW", txHash: hash("1"), burnedShares: "8000000000000", receivedUsdcMinor: "9117958" } },
    ]);
    render(<UsycPoolCard />);
    await userEvent.click(screen.getByRole("button", { name: "Withdraw all" })); await userEvent.click(screen.getByRole("button", { name: "Confirm?" }));
    expect(await screen.findByText(/is back in your wallet/, undefined, { timeout: 5000 })).toBeInTheDocument();
  });

  it("stops after a rejection in the wallet and sends nothing else", async () => {
    fake.send.mockReset().mockRejectedValue(Object.assign(new Error("User rejected"), { code: 4001 }));
    const fetcher = serve([{ body: { status: "READY", quote: depositQuote } }]);
    render(<UsycPoolCard />);
    await userEvent.type(screen.getByLabelText("USYC pool amount"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Deposit" })); await userEvent.click(screen.getByRole("button", { name: "Confirm?" }));
    expect(await screen.findByText(/You rejected the request in your wallet. Nothing was sent./)).toBeInTheDocument();
    expect(fake.send).toHaveBeenCalledTimes(1); expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("calls an unclear wallet failure unknown, not failed", async () => {
    fake.send.mockReset().mockRejectedValue(new Error("Lost provider response"));
    serve([{ body: { status: "READY", quote: withdrawQuote } }]);
    render(<UsycPoolCard />);
    await userEvent.click(screen.getByRole("button", { name: "Withdraw all" })); await userEvent.click(screen.getByRole("button", { name: "Confirm?" }));
    expect(await screen.findByText(/did not confirm whether it sent this/)).toBeInTheDocument();
  });

  it("shows the server's refusal and never opens the wallet", async () => {
    serve([{ ok: false, body: { status: "ERROR", code: "USYC_LIMIT_EXCEEDED", message: "The USYC pool can take at most 3 USDC right now. Choose a smaller amount. Nothing was sent." } }]);
    render(<UsycPoolCard />);
    await userEvent.type(screen.getByLabelText("USYC pool amount"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Deposit" })); await userEvent.click(screen.getByRole("button", { name: "Confirm?" }));
    expect(await screen.findByText(/can take at most 3 USDC/)).toBeInTheDocument();
    expect(fake.send).not.toHaveBeenCalled();
  });

  it("stops when the deposit transaction did something else", async () => {
    serve([
      { body: { status: "READY", quote: depositQuote } },
      { body: { status: "CONFIRMED", step: "APPROVE", txHash: hash("1") } },
      { body: { status: "REVERTED", step: "DEPOSIT", txHash: hash("2") } },
    ]);
    render(<UsycPoolCard />);
    await userEvent.type(screen.getByLabelText("USYC pool amount"), "5");
    await userEvent.click(screen.getByRole("button", { name: "Deposit" })); await userEvent.click(screen.getByRole("button", { name: "Confirm?" }));
    expect(await screen.findByText(/rejected this transaction. Your funds did not move./)).toBeInTheDocument();
    expect(fake.activity).not.toHaveBeenCalled();
  });

  it("refuses to start without a signer", async () => {
    fake.runtime.mockReturnValue(null);
    const fetcher = serve([]);
    render(<UsycPoolCard />);
    await userEvent.click(screen.getByRole("button", { name: "Withdraw all" })); await userEvent.click(screen.getByRole("button", { name: "Confirm?" }));
    expect(await screen.findByText(/wallet session is not active/)).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says the pool is not live while it is not deployed, with no actions", () => {
    fake.state = { status: "READY", data: { status: "READY", position: null, executionEnabled: true, executionNote: null, walletCanSign: true } };
    render(<UsycPoolCard />);
    expect(screen.getByText(/not live on Arc Testnet yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deposit" })).toBeNull();
  });

  it("keeps everything closed while Circle has not enabled the pool, and says why", () => {
    ready({}, { circle: "NOT_PERMITTED" });
    render(<UsycPoolCard />);
    for (const name of ["Deposit", "Withdraw", "Withdraw all"]) expect(screen.getByRole("button", { name })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("Waiting for Circle to enable Hodd's pool");
    expect(screen.getByText("Awaiting Circle")).toBeInTheDocument();
  });

  it("lets the user withdraw while Hodd has paused deposits", async () => {
    ready({}, { depositsPaused: true, maxDepositUsdc: "0" });
    render(<UsycPoolCard />);
    await userEvent.type(screen.getByLabelText("USYC pool amount"), "1");
    expect(screen.getByRole("button", { name: "Deposit" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Withdraw" })).toBeEnabled();
    expect(screen.getByRole("note")).toHaveTextContent("Withdrawals still work");
  });

  it("shows the operator's note while quotes are switched off", () => {
    ready({ executionEnabled: false, executionNote: "USYC trading is switched off by the operator. Nothing can be prepared right now." });
    render(<UsycPoolCard />);
    expect(screen.getByRole("button", { name: "Withdraw all" })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("switched off by the operator");
  });
});

describe("usycProgress", () => {
  it("moves through check, approve, deposit and verified", () => {
    const at = (stage: "check" | "APPROVE" | "DEPOSIT", sub: "preparing" | "wallet" | "confirming") => usycProgress({ kind: "DEPOSIT", stage, sub, outcome: "running" });
    expect(at("check", "preparing").steps.map((s) => s.state)).toEqual(["active", "waiting", "waiting", "waiting"]);
    expect(at("APPROVE", "wallet")).toMatchObject({ active: 1, caption: expect.stringContaining("Approve exactly this amount") });
    expect(at("DEPOSIT", "confirming").steps.map((s) => s.state)).toEqual(["done", "done", "active", "waiting"]);
    const done = usycProgress({ kind: "DEPOSIT", stage: "verified", sub: "confirming", outcome: "done" });
    expect(done.steps.every((s) => s.state === "done")).toBe(true);
    expect(done.active).toBe(3);
  });

  it("marks the step where a withdrawal stopped", () => {
    const failed = usycProgress({ kind: "WITHDRAW", stage: "WITHDRAW", sub: "wallet", outcome: "failed", message: "You rejected it." });
    expect(failed.steps.map((s) => s.state)).toEqual(["done", "failed", "waiting"]);
    expect(failed.caption).toBe("You rejected it.");
  });
});
