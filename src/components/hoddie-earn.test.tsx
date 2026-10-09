import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HoddieChat } from "./hoddie-chat";
import type { ServiceResult } from "@/lib/hoddie/client";
import type { HoddieModelReply } from "@/lib/hoddie/schema";

const wallet = "0x00000000000000000000000000000000000000b2";
const state = vi.hoisted(() => ({ execution: "LOCAL_ENABLED" as "LOCAL_ENABLED" | "READ_ONLY" }));

vi.mock("./treasury-workspace-provider", async () => {
  const { assessTreasury } = await import("@/lib/treasury/engine");
  const { initialWorkspace } = await import("@/lib/treasury/fixtures");
  const eu = (minorUnits: string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits });
  const vaultAddress = "0x00000000000000000000000000000000000000a1"; const wallet = "0x00000000000000000000000000000000000000b2";
  const workspace = { ...structuredClone(initialWorkspace), walletConnection: { address: wallet, connectedAt: "session", label: "Test", provider: "INJECTED_METAMASK" } };
  const assessment = assessTreasury(workspace as unknown as typeof initialWorkspace, new Date("2026-09-27T00:00:00.000Z"));
  const vault = { address: vaultAddress, name: "Allowlisted vault", chain: "ARC-TESTNET", protocol: "MORPHO", asset: "USDC", assetAddress: "0x0000000000000000000000000000000000000002", apyBps: 412, totalDeposits: eu("1000000000"), liquidity: eu("900000000"), status: "ACTIVE", circleGuarded: true, warnings: [], earnKitWarnings: [], verifiedAt: "2026-09-27T00:00:00.000Z", verifiedBlock: "1" };
  return { useTreasuryWorkspace: () => ({
    workspaceScope: "SMOKE_TEST", workspace, operationalWorkspace: workspace, assessment, hydrated: true, storageIssue: null,
    earnState: { status: "READY", portfolio: { status: "READY", integration: { discovery: "READY", positionAccess: "READY", execution: state.execution, configuredWalletAddress: wallet, message: "ok" }, vaults: [vault], positions: [], observedAt: "2026-09-27T00:00:00.000Z" } },
    previewHoddieChange: vi.fn(), applyHoddieChange: vi.fn(), syncForEarn: vi.fn(), recordEarnActivity: vi.fn(), recordEarnEvent: vi.fn(), refreshEarn: vi.fn(), refreshWallet: vi.fn(),
  }) };
});

const reply = (over: Partial<HoddieModelReply>): ServiceResult => ({ status: "READY", reply: { text: "Hazırladım.", followUps: [], labels: { approve: "Onaylıyorum", decline: "Vazgeç", proposal: "Önerilen işlem" }, action: null, actionRejected: false, approvesPending: false, ...over } });
const deposit = (amount: string) => ({ kind: "EARN_REQUEST" as const, change: { operation: "DEPOSIT", amount } });
const send = async (user: ReturnType<typeof userEvent.setup>, text: string) => { await user.type(screen.getByRole("textbox", { name: "Message Hoddie" }), `${text}{Enter}`); };
beforeEach(() => window.sessionStorage.clear());
afterEach(() => { cleanup(); state.execution = "LOCAL_ENABLED"; });

describe("Hoddie and Morpho", () => {
  it("prepares a deposit inside the engine limit and hands it to the signed Earn flow", async () => {
    const user = userEvent.setup();
    const service = vi.fn(async () => reply({ action: deposit("1000") }));
    render(<HoddieChat service={service} />);
    await send(user, "Boştaki parayı Morpho'ya yatır");
    expect(await screen.findByText("Önerilen işlem", undefined, { timeout: 3000 })).toBeVisible();
    expect(screen.getByText("Deposit 1,000.00 USDC into Allowlisted vault")).toBeVisible();
    expect(screen.getByText("Treasury Engine limit: 4,500.00 USDC")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Onaylıyorum" })).not.toBeInTheDocument(); // nothing here can sign or apply
    await user.click(screen.getByRole("button", { name: "Deposit" }));
    expect(await screen.findByLabelText("Deposit amount")).toHaveValue("1000");
    expect(screen.getByRole("button", { name: "Review fresh quote" })).toBeVisible();
    const sent = JSON.stringify((service.mock.calls[0] as unknown as [{ snapshot: unknown }])[0].snapshot);
    expect(sent).toContain('"depositLimit":"4500"'); expect(sent).not.toContain(wallet);
  });

  it("refuses to prepare a deposit above the engine limit, whatever the model asked for", async () => {
    const user = userEvent.setup();
    render(<HoddieChat service={async () => reply({ action: deposit("9000") })} />);
    await send(user, "hepsini yatır");
    expect(await screen.findByText(/above the limit the Treasury Engine allows right now: at most 4,500.00 USDC/, undefined, { timeout: 3000 })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Deposit" })).not.toBeInTheDocument();
  });

  it("cannot be approved by typing: the user must sign in the Earn flow", async () => {
    const user = userEvent.setup();
    const service = vi.fn<(request: unknown) => Promise<ServiceResult>>()
      .mockResolvedValueOnce(reply({ action: deposit("1000") }))
      .mockResolvedValueOnce(reply({ text: "Tamam.", approvesPending: true }));
    render(<HoddieChat service={service} />);
    await send(user, "yatır");
    await screen.findByRole("button", { name: "Deposit" }, { timeout: 3000 });
    await send(user, "onaylıyorum");
    await screen.findByText("Tamam.", undefined, { timeout: 3000 });
    expect(screen.getByRole("button", { name: "Deposit" })).toBeVisible();
    expect(screen.queryByText("Applied")).not.toBeInTheDocument();
  });

  it("keeps the Morpho action disabled where Earn execution is not enabled, and says why", async () => {
    state.execution = "READ_ONLY";
    const user = userEvent.setup();
    render(<HoddieChat service={async () => reply({ action: deposit("1000") })} />);
    await send(user, "yatır");
    expect(await screen.findByText(/can be signed only where Earn execution is enabled/, undefined, { timeout: 3000 })).toBeVisible();
    expect(screen.getByRole("button", { name: "Deposit" })).toBeDisabled();
  });

  it("lets the user decline a Morpho proposal", async () => {
    const user = userEvent.setup();
    render(<HoddieChat service={async () => reply({ action: deposit("1000") })} />);
    await send(user, "yatır");
    await user.click(await screen.findByRole("button", { name: "Vazgeç" }, { timeout: 3000 }));
    expect(screen.getByText("Declined")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Deposit" })).not.toBeInTheDocument();
  });
});
