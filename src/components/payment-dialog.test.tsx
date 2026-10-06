import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace, usdc } from "@/lib/treasury/fixtures";
import type { WalletConnection } from "@/lib/treasury/models";
import { PaymentDialog } from "./payment-dialog";
const fake = vi.hoisted(() => ({ sync: vi.fn(async () => undefined), refresh: vi.fn(async () => undefined), runtime: vi.fn(), approve: vi.fn(async () => undefined) }));
const wallet: WalletConnection = { provider: "INJECTED_METAMASK", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address: "0x0000000000000000000000000000000000000001", label: "Test", connectedAt: "2026-10-02T00:00:00Z" };
vi.mock("./treasury-workspace-provider", () => ({ useTreasuryWorkspace: () => ({ workspace: { walletConnection: wallet }, workspaceScope: "TREASURY", syncForEarn: fake.sync, refreshPaymentLedger: fake.refresh }) }));
vi.mock("@/lib/wallet/runtime", () => ({ getActiveWalletRuntime: fake.runtime }));
const obligation = { ...initialWorkspace.obligations[0], revision: 1, recipientAddress: "0x0000000000000000000000000000000000000002" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
describe("payment review UI", () => {
  it("reviews without signing and keeps an unverified provider disabled, with focus return", async () => {
    const fetch = vi.fn(async () => ({ json: async () => ({ status: "READY", pending: null, record: { id: "11111111-1111-4111-8111-111111111111", state: "REVIEW_REQUIRED", txHash: null, userOperationHash: null, receipt: null, proposal: { id: "11111111-1111-4111-8111-111111111111", scope: "TREASURY", obligationId: obligation.id, obligationRevision: 1, wallet, recipientAddress: obligation.recipientAddress, recipientLabel: "Vendor", amount: usdc("1000000"), feeReserve: usdc("1000"), balanceAfter: usdc("9000000"), gasBudgetWei: "1000000000000000", startBlock: "10", expiresAt: "2099-01-01T00:00:00Z", policy: { status: "PASS", label: "Policy", reason: "Protected capital preserved" }, executionEnabled: false, executionReason: "Stage 4 live verification required" } } }) }));
    vi.stubGlobal("fetch", fetch); const user = userEvent.setup(); render(<PaymentDialog obligation={obligation} />);
    const trigger = screen.getByRole("button", { name: /review payment for/i }); await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Review fresh payment proposal" }));
    expect(await screen.findByText("Stage 4 live verification required")).toBeVisible();
    expect(screen.getByRole("button", { name: "Confirm full testnet payment" })).toBeDisabled(); expect(fetch).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "Close payment dialog" })); expect(trigger).toHaveFocus();
  });
  it("disables draft and addressless obligations", () => {
    render(<PaymentDialog obligation={{ ...obligation, status: "DRAFT", recipientAddress: null }} />);
    expect(screen.getByRole("button", { name: /review payment for/i })).toBeDisabled();
  });
  it("requires separate confirmation, executes the PIN challenge and refreshes canonical state", async () => {
    const embedded = { ...wallet, provider: "CIRCLE_USER_CONTROLLED", accountType: "SCA", walletId: "public-id" };
    const id = "11111111-1111-4111-8111-111111111111";
    const proposal = { id, scope: "TREASURY", obligationId: obligation.id, obligationRevision: 1, wallet: embedded, recipientAddress: obligation.recipientAddress, recipientLabel: "Vendor", amount: usdc("1000000"), feeReserve: usdc("1000"), balanceAfter: usdc("9000000"), gasBudgetWei: "1000000000000000", startBlock: "10", expiresAt: "2099-01-01T00:00:00Z", policy: { status: "PASS", label: "Policy", reason: "Protected" }, executionEnabled: true, executionReason: "Verified provider" };
    fake.runtime.mockReturnValue({ connection: embedded, approveChallenge: fake.approve });
    const fetch = vi.fn(async (_url, options) => {
      const input = JSON.parse(options.body); const state = input.action === "REVIEW" ? "REVIEW_REQUIRED" : input.action === "CONFIRM" ? "AWAITING_SIGNATURE" : "CONFIRMED";
      return { json: async () => ({ status: "READY", record: { id, state, proposal, txHash: null, userOperationHash: null, receipt: null }, pending: input.action === "CONFIRM" ? { id, challengeId: "mock-challenge", calls: [], gasBudgetWei: "1000000000000000" } : null }) };
    });
    vi.stubGlobal("fetch", fetch); const user = userEvent.setup(); render(<PaymentDialog obligation={obligation} />);
    await user.click(screen.getByRole("button", { name: /review payment for/i })); await user.click(screen.getByRole("button", { name: "Review fresh payment proposal" }));
    expect(fake.approve).not.toHaveBeenCalled(); await user.click(screen.getByRole("button", { name: "Confirm full testnet payment" }));
    expect(await screen.findByText(/authoritative PAID record is loaded/i)).toBeVisible(); expect(fake.approve).toHaveBeenCalledWith("mock-challenge"); expect(fake.refresh).toHaveBeenCalled();
    const reply = fetch.mock.calls.map(([, options]) => JSON.parse(options.body)).find((body) => body.action === "REPLY"); expect(reply.challengeApproved).toBe(true); expect(reply.txHash).toBeUndefined();
  });
});
