import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EarnOperationDialog } from "./earn-operation-dialog";
import type { EarnQuote, EarnVault } from "@/lib/earn/models";
const fake = vi.hoisted(() => ({ sync: vi.fn(), activity: vi.fn(), event: vi.fn(), runtime: vi.fn(), send: vi.fn(), pin: vi.fn() }));
const money = { currency: "USDC" as const, decimals: 6 as const, minorUnits: "1000000" };
const wallet = "0x0000000000000000000000000000000000000001";
const vault = { address: "0x0000000000000000000000000000000000000002", name: "Allowlisted vault" } as EarnVault;
const id = "12345678-1234-4123-8123-123456789abc";
const hash = `0x${"1".repeat(64)}`;
vi.mock("./treasury-workspace-provider", () => ({ useTreasuryWorkspace: () => ({ workspaceScope: "SMOKE_TEST", workspace: { walletConnection: { address: wallet, connectedAt: "session" } }, syncForEarn: fake.sync, recordEarnActivity: fake.activity, recordEarnEvent: fake.event, refreshEarn: vi.fn(), refreshWallet: vi.fn() }) }));
vi.mock("@/lib/wallet/runtime", () => ({ getActiveWalletRuntime: fake.runtime }));
const quote: EarnQuote = { quoteId: id, operation: "DEPOSIT", walletAddress: wallet, vaultAddress: vault.address, vaultName: vault.name, amount: money, fees: { ...money, minorUnits: "1" }, gasFees: [], expectedShares: null, sharesToRedeem: null, maxWithdrawable: null, warnings: [], requiresWarningAcknowledgement: false, policy: { status: "PASS", label: "Policy", reason: "Server approved" }, expiresAt: "2099-01-01T00:05:00.000Z" };
const pending = { id, stage: "EARN", calls: [{ to: vault.address, data: "0x1234" }], gasBudgetWei: "1000000000000000" };
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
  it("does not sign on review and sends no client policy overrides", async () => {
    const fetcher = fetchResponses([{ status: "READY", quote }]); await review();
    expect(fake.send).not.toHaveBeenCalled(); expect(fake.sync).toHaveBeenCalled();
    expect(JSON.parse(fetcher.mock.calls[0][1].body as string)).toEqual({ operation: "DEPOSIT", amount: "1", vaultAddress: vault.address, workspaceScope: "SMOKE_TEST" });
    await userEvent.click(screen.getByLabelText("Close Deposit dialog")); expect(screen.getByRole("button", { name: "Deposit" })).toHaveFocus();
  });
  it.each(["browser", "passkey", "embedded"])("requires separate confirmation and records only verified completion for %s", async (provider) => {
    const activeJob = provider === "embedded" ? { ...job, pending: { ...pending, calls: [], challengeId: "challenge" } } : job;
    fetchResponses([{ status: "READY", quote }, activeJob, complete]); await review();
    await userEvent.click(screen.getByRole("button", { name: "Confirm onchain deposit" })); await screen.findByText("Arc Testnet receipt returned.");
    expect(provider === "embedded" ? fake.pin : fake.send).toHaveBeenCalledTimes(1);
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
    const fetcher = fetchResponses([{ status: "READY", quote }, job, { ...job, pending: null, state: "FAILED" }]); await review(); fake.runtime.mockReturnValue(null);
    await userEvent.click(screen.getByRole("button", { name: "Confirm onchain deposit" })); await screen.findByRole("alert");
    expect(fake.send).not.toHaveBeenCalled(); await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
  });
});
