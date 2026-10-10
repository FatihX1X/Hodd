import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EarnOperationDialog } from "./earn-operation-dialog";
import type { EarnQuote, EarnVault } from "@/lib/earn/models";
import { WalletPreflightError } from "@/lib/wallet/preflight";
import { setActiveWalletRuntime } from "@/lib/wallet/runtime";
const fake = vi.hoisted(() => ({ sync: vi.fn(), activity: vi.fn(), event: vi.fn(), runtime: vi.fn(), send: vi.fn(), pin: vi.fn() }));
const money = { currency: "USDC" as const, decimals: 6 as const, minorUnits: "1000000" };
const wallet = "0x0000000000000000000000000000000000000001";
const vault = { address: "0x0000000000000000000000000000000000000002", name: "Allowlisted vault" } as EarnVault;
const id = "12345678-1234-4123-8123-123456789abc";
const hash = `0x${"1".repeat(64)}`;
vi.mock("./treasury-workspace-provider", () => ({ useTreasuryWorkspace: () => ({ workspaceScope: "SMOKE_TEST", workspace: { walletConnection: { address: wallet, connectedAt: "session" } }, syncForEarn: fake.sync, recordEarnActivity: fake.activity, recordEarnEvent: fake.event, refreshEarn: vi.fn(), refreshWallet: vi.fn() }) }));
vi.mock("@/lib/wallet/runtime", async (original) => ({ ...(await original<typeof import("@/lib/wallet/runtime")>()), getActiveWalletRuntime: fake.runtime, peekActiveWalletRuntime: () => fake.runtime() }));
const quote: EarnQuote = { quoteId: id, operation: "DEPOSIT", walletAddress: wallet, vaultAddress: vault.address, vaultName: vault.name, amount: money, fees: { ...money, minorUnits: "1" }, gasFees: [], expectedShares: null, sharesToRedeem: null, maxWithdrawable: null, warnings: [], requiresWarningAcknowledgement: false, policy: { status: "PASS", label: "Policy", reason: "Server approved" }, expiresAt: "2099-01-01T00:05:00.000Z" };
const pending = { id, stage: "EARN", calls: [{ to: vault.address, data: "0x1234" }], gasBudgetWei: "1000000000000000", gasCeiling: { gasLimit: "30000", gasPriceWei: "20000000000" } };
const job = { status: "PENDING", executionId: id, state: "AWAITING_SIGNATURE", events: [{ stage: "USER_CONFIRMED" }], pending, result: null };
const complete = { ...job, state: "COMPLETE", pending: null, events: [...job.events, { stage: "EARN_CONFIRMED", hash }], result: { executionId: id, operation: "DEPOSIT", status: "COMPLETE", txHash: hash, explorerUrl: `https://testnet.arcscan.app/tx/${hash}`, vaultAddress: vault.address, amount: money, residualPosition: null } };
function fetchResponses(responses: unknown[]) { const fetcher = vi.fn(async (...args: [string, RequestInit]) => { void args; return { json: async () => responses.shift() }; }); vi.stubGlobal("fetch", fetcher); return fetcher; }
async function review() {
  render(<EarnOperationDialog operation="DEPOSIT" vault={vault} policyLimit={money} enabled />);
  await userEvent.click(screen.getByRole("button", { name: "Deposit" })); await userEvent.type(screen.getByLabelText("Deposit amount"), "1");
  await userEvent.click(screen.getByRole("button", { name: "Review fresh quote" })); await screen.findByText("Server approved");
}
beforeEach(() => { vi.clearAllMocks(); fake.sync.mockResolvedValue(undefined); fake.send.mockResolvedValue(hash); fake.pin.mockResolvedValue(undefined); fake.runtime.mockReturnValue({ connection: { address: wallet, connectedAt: "session" }, sendCalls: fake.send, approveChallenge: fake.pin }); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("two-step Earn confirmation", () => {
  it("refuses to quote without an in-memory signer and asks to reconnect", async () => {
    fake.runtime.mockReturnValue(null); const fetcher = fetchResponses([]);
    render(<EarnOperationDialog operation="DEPOSIT" vault={vault} policyLimit={money} enabled />);
    await userEvent.click(screen.getByRole("button", { name: "Deposit" })); await userEvent.type(screen.getByLabelText("Deposit amount"), "1");
    await userEvent.click(screen.getByRole("button", { name: "Review fresh quote" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Signer session is not active");
    expect(fetcher).not.toHaveBeenCalled(); expect(fake.sync).not.toHaveBeenCalled();
  });
  it("does not consume the quote when the signer is lost after review", async () => {
    const fetcher = fetchResponses([{ status: "READY", quote }]); await review();
    fake.runtime.mockReturnValue({ connection: { address: wallet, connectedAt: "older-session" }, sendCalls: fake.send });
    act(() => setActiveWalletRuntime(fake.runtime())); // notify subscribers of the signer change
    expect(await screen.findByRole("button", { name: "Confirm onchain deposit" })).toBeDisabled();
    expect(screen.getByRole("note")).toHaveTextContent("Reconnect signer");
    expect(fetcher).toHaveBeenCalledTimes(1); expect(fake.send).not.toHaveBeenCalled();
  });
  it("cancels safely on proven pre-signature failure without retrying", async () => {
    const fetcher = fetchResponses([{ status: "READY", quote }, job, { ...job, state: "FAILED", pending: null }]);
    fake.send.mockRejectedValue(new WalletPreflightError("WALLET_PREFLIGHT_FAILED", "Read-only checks failed."));
    await review(); await userEvent.click(screen.getByRole("button", { name: "Confirm onchain deposit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Wallet preflight (WALLET_PREFLIGHT_FAILED)");
    expect(screen.getByRole("button", { name: "Confirm onchain deposit" })).toBeDisabled();
    expect(JSON.parse(fetcher.mock.calls[2][1].body as string)).toMatchObject({ cancelled: true, uncertain: false });
    expect(fake.send).toHaveBeenCalledTimes(1);
  });
  it("keeps an ambiguous wallet send failure UNKNOWN", async () => {
    const fetcher = fetchResponses([{ status: "READY", quote }, job, { ...job, state: "UNKNOWN", pending: null }]);
    fake.send.mockRejectedValue(new Error("Lost provider response"));
    await review(); await userEvent.click(screen.getByRole("button", { name: "Confirm onchain deposit" }));
    await screen.findByRole("alert");
    expect(JSON.parse(fetcher.mock.calls[2][1].body as string)).toMatchObject({ cancelled: true, uncertain: true });
    expect(fake.send).toHaveBeenCalledTimes(1);
  });
  it("shows safe pre-signature diagnostics without opening PIN or sending calls", async () => {
    fetchResponses([{ status: "READY", quote }, { ...job, state: "FAILED", pending: null, failure: { code: "SDK_FAILURE", stage: "CHALLENGE_CREATION", providerCode: "155104" } }]);
    await review(); await userEvent.click(screen.getByRole("button", { name: "Confirm onchain deposit" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("CHALLENGE_CREATION / SDK_FAILURE / Circle 155104");
    expect(fake.pin).not.toHaveBeenCalled(); expect(fake.send).not.toHaveBeenCalled();
  });
  it("does not sign on review and sends no client policy overrides", async () => {
    const fetcher = fetchResponses([{ status: "READY", quote }]); await review();
    expect(fake.send).not.toHaveBeenCalled(); expect(fake.sync).toHaveBeenCalled();
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({ operation: "DEPOSIT", amount: "1", vaultAddress: vault.address, workspaceScope: "SMOKE_TEST" });
    await userEvent.click(screen.getByLabelText("Close Deposit dialog")); expect(screen.getByRole("button", { name: "Deposit" })).toHaveFocus();
  });
  it.each(["browser", "passkey", "embedded"])("requires separate confirmation and records only verified completion for %s", async (provider) => {
    const activeJob = provider === "embedded" ? { ...job, pending: { ...pending, calls: [], challengeId: "challenge" } } : job;
    fetchResponses([{ status: "READY", quote }, activeJob, complete]); await review();
    await userEvent.click(screen.getByRole("button", { name: "Confirm onchain deposit" })); await screen.findByText("Deposit verified on Arc Testnet.");
    expect(screen.getByRole("link", { name: /open transaction/i })).toHaveAttribute("href", `https://testnet.arcscan.app/tx/${hash}`);
    expect(provider === "embedded" ? fake.pin : fake.send).toHaveBeenCalledTimes(1);
    if (provider === "browser") expect(fake.send).toHaveBeenCalledWith(pending.calls, pending.gasBudgetWei, expect.any(Function), undefined, pending.gasCeiling);
    expect(fake.event).toHaveBeenCalledWith("EARN_CONFIRMED", hash);
  });
  it("blocks policy rejection without ever asking the signer", async () => {
    fetchResponses([{ status: "READY", quote: { ...quote, quoteId: null, policy: { ...quote.policy, status: "BLOCKED" } } }]); await review();
    expect(screen.getByRole("button", { name: "Confirm onchain deposit" })).toBeDisabled(); expect(fake.send).not.toHaveBeenCalled();
  });
  it.each(["browser", "passkey", "embedded"])("reports provider cancellation without automatic retry for %s", async (provider) => {
    const active = provider === "embedded" ? { ...job, pending: { ...pending, calls: [], challengeId: "challenge" } } : job;
    const fetcher = fetchResponses([{ status: "READY", quote }, active, { ...job, state: "FAILED", pending: null }]);
    fake.send.mockRejectedValue({ code: 4001 }); fake.pin.mockRejectedValue(new Error("Cancelled")); await review();
    await userEvent.click(screen.getByRole("button", { name: "Confirm onchain deposit" })); await screen.findByRole("alert");
    expect(provider === "embedded" ? fake.pin : fake.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[2][1].body as string)).toMatchObject({ cancelled: true, uncertain: provider === "embedded" });
  });
  it("rejects a changed signer and preserves UNKNOWN rather than retrying", async () => {
    const fetcher = fetchResponses([{ status: "READY", quote }, job, { ...job, pending: null, state: "FAILED" }]); await review();
    // The signer disappears after /execute started the job (e.g. expiry while waiting).
    const base = fetcher.getMockImplementation()!;
    fetcher.mockImplementation(async (...args) => { const reply = await base(...args); if (String(args[0]).endsWith("/api/earn/execute")) fake.runtime.mockReturnValue(null); return reply; });
    await userEvent.click(screen.getByRole("button", { name: "Confirm onchain deposit" })); expect(await screen.findByRole("alert")).toHaveTextContent("signer session changed");
    expect(JSON.parse(fetcher.mock.calls[2][1].body as string)).toMatchObject({ cancelled: true });
    expect(fake.send).not.toHaveBeenCalled(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  });
});
