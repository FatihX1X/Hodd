import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { usdc } from "@/test/fixtures";
import { PaymentHistory } from "./payment-history";

const db = vi.hoisted(() => ({ proposals: [] as unknown[], events: [] as unknown[], scope: "TREASURY", updatedAt: "2026-10-09T12:00:00.000Z", authChange: undefined as undefined | ((event: string) => void) }));
vi.mock("@/lib/supabase/client", () => ({ createSupabaseBrowserClient: () => ({
  auth: { getUser: async () => ({ data: { user: { id: "test-user" } } }), onAuthStateChange: (callback: (event: string) => void) => { db.authChange = callback; return { data: { subscription: { unsubscribe: () => undefined } } }; } },
  from: (table: string) => { const query = { select: () => query, eq: () => query, order: () => query, limit: async () => ({ data: table === "payment_proposals" ? db.proposals : db.events, error: null }) }; return query; },
}) }));
vi.mock("./treasury-workspace-provider", () => ({ useTreasuryWorkspace: () => ({ workspaceScope: db.scope, workspace: { updatedAt: db.updatedAt }, paymentLedgerRevision: 0, refreshPaymentLedger: async () => undefined }) }));

const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const wallet = { provider: "INJECTED_METAMASK", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address: "0x0000000000000000000000000000000000000001", label: "Test", connectedAt: "2026-10-02T00:00:00Z" };
const proposal = (n: number) => ({ id: uuid(n), scope: "TREASURY", obligationId: "bill", obligationRevision: 1, wallet, recipientAddress: "0x0000000000000000000000000000000000000002", recipientLabel: `Payee ${String(n).padStart(2, "0")}`, amount: usdc("1000000"), feeReserve: usdc("1000"), balanceAfter: usdc("9000000"), gasBudgetWei: "1000000000000000", startBlock: "10", expiresAt: "2099-01-01T00:00:00Z", policy: { status: "PASS", label: "Policy", reason: "Protected" }, executionEnabled: true, executionReason: "Verified provider" });
// Payment 17 is UNKNOWN with no hash, so it sits on the second page and needs a recovery input.
const row = (n: number) => ({ id: uuid(n), state: n === 17 ? "UNKNOWN" : "CONFIRMED", proposal: proposal(n), tx_hash: null, user_operation_hash: null, receipt: null });
const audit = (n: number) => ({ id: n, proposal_id: uuid(1000 + n), stage: "CONFIRMED", kind: "LOCAL_AUDIT", tx_hash: null, occurred_at: "2026-10-09T12:00:00.000Z" });
const payees = () => screen.getAllByText(/Payee \d\d$/).map((item) => item.textContent?.slice(-8));
const timeline = () => within(screen.getByRole("list", { name: "Server payment audit timeline" })).getAllByRole("listitem");
const recoveryInput = () => screen.queryByLabelText(`Existing transaction hash ${uuid(17)}`);

beforeEach(() => { db.proposals = Array.from({ length: 20 }, (_, index) => row(index + 1)); db.events = Array.from({ length: 20 }, (_, index) => audit(index + 1)); db.scope = "TREASURY"; db.updatedAt = "2026-10-09T12:00:00.000Z"; db.authChange = undefined; });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("payment history pagination", () => {
  it("shows fifteen payment records per page and keeps recovery inputs for every page", async () => {
    const user = userEvent.setup(); render(<PaymentHistory />);
    const nav = await screen.findByRole("navigation", { name: "Server payment ledger pages" });
    expect(payees()).toHaveLength(15); expect(payees()[0]).toBe("Payee 01"); expect(within(nav).getByText("1–15 of 20")).toBeVisible();
    expect(screen.queryByText(`Proposal ${uuid(17)}`)).not.toBeInTheDocument(); expect(recoveryInput()).toBeVisible();
    await user.click(within(nav).getByRole("button", { name: "Next" }));
    expect(payees()).toEqual(["Payee 16", "Payee 17", "Payee 18", "Payee 19", "Payee 20"]); expect(within(nav).getByText("16–20 of 20")).toBeVisible();
    expect(screen.getByText(`Proposal ${uuid(17)}`)).toBeVisible(); expect(recoveryInput()).toBeVisible();
  });

  it("pages the audit timeline separately from the payment records", async () => {
    const user = userEvent.setup(); render(<PaymentHistory />);
    const nav = await screen.findByRole("navigation", { name: "Server payment audit timeline pages" });
    expect(timeline()).toHaveLength(15); expect(within(nav).getByText("1–15 of 20")).toBeVisible();
    await user.click(within(nav).getByRole("button", { name: "Next" }));
    expect(timeline()).toHaveLength(5); expect(timeline()[0]).toHaveTextContent(uuid(1016)); expect(within(nav).getByText("16–20 of 20")).toBeVisible();
    expect(payees()).toHaveLength(15); expect(payees()[0]).toBe("Payee 01");
  });

  it("has no pagination for a short ledger", async () => {
    db.proposals = db.proposals.slice(0, 15); db.events = db.events.slice(0, 3); render(<PaymentHistory />);
    await waitFor(() => expect(timeline()).toHaveLength(3)); expect(payees()).toHaveLength(15);
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("returns both lists to the first page on sign-in and when the scope changes", async () => {
    const user = userEvent.setup(); const { rerender } = render(<PaymentHistory />);
    const records = await screen.findByRole("navigation", { name: "Server payment ledger pages" }); const events = screen.getByRole("navigation", { name: "Server payment audit timeline pages" });
    await user.click(within(records).getByRole("button", { name: "Next" })); await user.click(within(events).getByRole("button", { name: "Next" }));
    expect(payees()[0]).toBe("Payee 16"); expect(timeline()).toHaveLength(5);
    act(() => db.authChange?.("SIGNED_IN"));
    await waitFor(() => { expect(payees()[0]).toBe("Payee 01"); expect(timeline()).toHaveLength(15); });
    await user.click(within(screen.getByRole("navigation", { name: "Server payment ledger pages" })).getByRole("button", { name: "Next" })); expect(payees()[0]).toBe("Payee 16");
    db.scope = "SMOKE_TEST"; rerender(<PaymentHistory />);
    await waitFor(() => expect(payees()[0]).toBe("Payee 01"));
  });

  it("clamps to the last page when the ledger shrinks", async () => {
    const user = userEvent.setup(); const { rerender } = render(<PaymentHistory />);
    await user.click(within(await screen.findByRole("navigation", { name: "Server payment ledger pages" })).getByRole("button", { name: "Next" }));
    expect(payees()).toHaveLength(5);
    db.proposals = db.proposals.slice(0, 9); db.updatedAt = "2026-10-09T13:00:00.000Z"; rerender(<PaymentHistory />);
    await waitFor(() => expect(payees()).toHaveLength(9)); expect(payees()[0]).toBe("Payee 01"); expect(screen.queryByRole("navigation", { name: "Server payment ledger pages" })).not.toBeInTheDocument();
  });
});
