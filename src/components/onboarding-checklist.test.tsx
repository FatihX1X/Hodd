import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OnboardingChecklist } from "./onboarding-checklist";
import { createLiveStarterWorkspace } from "@/lib/treasury/starter";
import { sampleWorkspace } from "@/lib/treasury/fixtures";
import type { useTreasuryWorkspace } from "./treasury-workspace-provider";

type ChecklistContext = Pick<ReturnType<typeof useTreasuryWorkspace>, "mode" | "signedIn" | "workspace" | "walletState" | "earnState">;
const fake = vi.hoisted(() => ({ context: {} as ChecklistContext }));
vi.mock("./treasury-workspace-provider", () => ({ useTreasuryWorkspace: () => fake.context }));
const address = "0x0000000000000000000000000000000000000001";
beforeEach(() => { fake.context = { mode: "LIVE", signedIn: true, workspace: createLiveStarterWorkspace(), walletState: { status: "IDLE" }, earnState: { status: "IDLE" } }; });
afterEach(cleanup);

it("shows real pending steps and the Arc Testnet faucet instruction", () => {
  render(<OnboardingChecklist />);
  expect(within(screen.getByRole("list")).getAllByRole("listitem")).toHaveLength(5);
  expect(screen.getAllByText("Not done")).toHaveLength(4); expect(screen.getByText("Done")).toBeVisible();
  expect(screen.getByRole("link", { name: "Get free testnet USDC" })).toHaveAttribute("href", "https://faucet.circle.com");
  expect(screen.getByText("Choose Arc Testnet in the Circle faucet.")).toBeVisible();
  expect(screen.queryByRole("button", { name: "Collapse checklist" })).not.toBeInTheDocument();
});

it("copies the connected public address and collapses only when complete", async () => {
  const user = userEvent.setup();
  const now = "2026-10-09T12:00:00.000Z";
  fake.context.workspace = { ...fake.context.workspace, treasuryMode: "ARC_TESTNET_WALLET", walletConnection: { provider: "INJECTED_METAMASK", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address, label: "My wallet", connectedAt: now }, obligations: [{ ...sampleWorkspace.obligations[0], id: "my-bill" }] };
  const balance = { currency: "USDC" as const, decimals: 6 as const, minorUnits: "1000000" };
  fake.context.walletState = { status: "READY", snapshot: { address, chain: "ARC-TESTNET", chainId: 5042002, balance, blockNumber: "1", observedAt: now } };
  fake.context.earnState = { status: "READY", portfolio: { status: "READY", observedAt: now, vaults: [], integration: { discovery: "READY", positionAccess: "READY", execution: "READ_ONLY", configuredWalletAddress: address, message: "Live data" }, positions: [{ walletAddress: address, vaultAddress: address, vaultName: "Morpho", currentBalance: balance, redeemable: balance, maxWithdrawable: balance, liquidityStatus: "READY", shares: "1", apyBps: 400, pnl: { status: "PENDING" }, observedAt: now }] } };
  render(<OnboardingChecklist />);
  await user.click(screen.getByRole("button", { name: "Copy address" }));
  expect(await navigator.clipboard.readText()).toBe(address); expect(screen.getByRole("status")).toHaveTextContent("Address copied");
  expect(screen.getAllByText("Done")).toHaveLength(5);
  await user.click(screen.getByRole("button", { name: "Collapse checklist" })); expect(screen.queryByRole("list")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Show checklist" })); expect(screen.getByRole("list")).toBeVisible();
});

it("does not present onboarding progress in DEMO", () => {
  fake.context.mode = "DEMO"; const { container } = render(<OnboardingChecklist />); expect(container).toBeEmptyDOMElement();
});
