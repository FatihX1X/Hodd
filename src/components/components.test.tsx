import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./app-shell";
import { InvestmentWorkspace } from "./investment-workspace";
import { ObligationExplorer } from "./obligation-explorer";
import { StatusPill } from "./primitives";
import { TreasuryWorkspaceProvider } from "./treasury-workspace-provider";
import { WalletPanel } from "./wallet-panel";
import { initialWorkspace } from "@/lib/treasury/fixtures";
import { WORKSPACE_STORAGE_KEY } from "@/lib/treasury/repository";

vi.mock("next/navigation", () => ({ usePathname: () => "/obligations" }));
const renderWorkspace = (node: React.ReactNode) => render(<TreasuryWorkspaceProvider>{node}</TreasuryWorkspaceProvider>);
const earnReadOnlyResponse = { status: "READY", integration: { discovery: "READY", positionAccess: "NOT_CONFIGURED", execution: "READ_ONLY", configuredWalletAddress: null, message: "Live vault discovery; wallet credentials are not configured." }, vaults: [], positions: [], observedAt: "2026-09-28T12:00:00.000Z" };
beforeEach(() => { window.localStorage.clear(); window.HTMLElement.prototype.scrollIntoView = vi.fn(); vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => earnReadOnlyResponse }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("Stage 4 interactions", () => {
  it("marks the active navigation destination", () => { renderWorkspace(<AppShell><div>Content</div></AppShell>); expect(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("link", { name: "Obligations" })).toHaveAttribute("aria-current", "page"); });
  it("creates an obligation and recalculates protected capital", async () => {
    const user = userEvent.setup(); renderWorkspace(<ObligationExplorer />); await user.click(screen.getByRole("button", { name: /new obligation/i }));
    await user.type(screen.getByLabelText("Obligation title"), "Urgent invoice"); await user.type(screen.getByLabelText("Obligation amount"), "2000");
    await user.clear(screen.getByLabelText("Due date")); await user.type(screen.getByLabelText("Due date"), "2026-09-28"); await user.click(screen.getByRole("button", { name: /save and recalculate/i }));
    expect(await screen.findByText("Urgent invoice")).toBeVisible(); expect(screen.getByText("6,500.00 USDC")).toBeVisible(); expect(screen.getByText("2,500.00 USDC")).toBeVisible();
  });
  it("rejects allocation targets that do not total 100 percent", async () => { const user = userEvent.setup(); renderWorkspace(<InvestmentWorkspace />); await user.clear(screen.getByLabelText("Morpho target")); await user.type(screen.getByLabelText("Morpho target"), "40"); await user.click(screen.getByRole("button", { name: /save targets/i })); expect(screen.getByRole("alert")).toHaveTextContent("exactly 100%"); });
  it("opens a deterministic allocation preview and returns focus", async () => { const user = userEvent.setup(); renderWorkspace(<InvestmentWorkspace />); const trigger = screen.getByRole("button", { name: /preview engine plan/i }); await user.click(trigger); expect(screen.getByRole("dialog", { name: /allocation plan/i })).toBeVisible(); expect(screen.getByRole("button", { name: /execution begins/i })).toBeDisabled(); await user.click(screen.getByRole("button", { name: /close investment preview/i })); expect(trigger).toHaveFocus(); });
  it("renders a textual state in addition to color", () => { render(<StatusPill label="SAFE" tone="success" />); expect(screen.getByText("SAFE")).toBeVisible(); });
  it("validates and links only a public Arc Testnet wallet address", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => ({ json: async () => String(input).includes("/api/arc/treasury") ? { status: "READY", snapshot: { address: "0x0000000000000000000000000000000000000001", chain: "ARC-TESTNET", chainId: 5_042_002, balance: { currency: "USDC", minorUnits: "20000000", decimals: 6 }, blockNumber: "42", observedAt: "2026-09-27T12:00:00.000Z" } } : earnReadOnlyResponse })));
    const user = userEvent.setup(); renderWorkspace(<WalletPanel />); await user.click(screen.getByRole("button", { name: /connect wallet/i }));
    await user.type(screen.getByLabelText("Public Arc Testnet address"), "invalid"); await user.click(screen.getByRole("button", { name: /link public address/i })); expect(screen.getByRole("alert")).toHaveTextContent(/valid EVM wallet address/i);
    await user.clear(screen.getByLabelText("Public Arc Testnet address")); await user.type(screen.getByLabelText("Public Arc Testnet address"), "0x0000000000000000000000000000000000000001"); await user.click(screen.getByRole("button", { name: /link public address/i }));
    expect(await screen.findByText("20.00 USDC")).toBeVisible(); expect(screen.getByText(/signing: disabled/i)).toBeVisible(); expect(screen.getByText(/execution: disabled/i)).toBeVisible();
  });
  it("uses a fresh quote and separate confirmation before a local Earn deposit", async () => {
    const address = "0x0000000000000000000000000000000000000001";
    const vaultAddress = "0xAABbeF1d3971C710276Ed41ec791Bbe14cDB8e88";
    const linked = { ...initialWorkspace, treasuryMode: "ARC_TESTNET_WALLET" as const, walletConnection: { provider: "CIRCLE_DEVELOPER_CONTROLLED_WALLET" as const, chain: "ARC-TESTNET" as const, chainId: 5_042_002 as const, address, label: "Earn wallet", connectedAt: "2026-09-28T12:00:00.000Z" } };
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(linked));
    const portfolio = { status: "READY", integration: { discovery: "READY", positionAccess: "READY", execution: "LOCAL_ENABLED", configuredWalletAddress: address, message: "Local execution enabled." }, vaults: [{ address: vaultAddress, name: "EarnKit USDC Vault", chain: "ARC-TESTNET", protocol: "MORPHO", asset: "USDC", assetAddress: "0x3600000000000000000000000000000000000000", apyBps: 420, totalDeposits: { currency: "USDC", decimals: 6, minorUnits: "1000000000000" }, liquidity: { currency: "USDC", decimals: 6, minorUnits: "1000000000000" }, status: "ACTIVE", circleGuarded: true, warnings: [], earnKitWarnings: [], verifiedAt: "2026-09-28T12:00:00.000Z", verifiedBlock: "64465893" }], positions: [{ walletAddress: address, vaultAddress, vaultName: "EarnKit USDC Vault", currentBalance: { currency: "USDC", decimals: 6, minorUnits: "2000000" }, maxWithdrawable: { currency: "USDC", decimals: 6, minorUnits: "2000000" }, redeemable: { currency: "USDC", decimals: 6, minorUnits: "2000000" }, liquidityStatus: "READY", shares: "2", apyBps: 420, pnl: { status: "PENDING" }, observedAt: "2026-09-28T12:00:00.000Z" }], observedAt: "2026-09-28T12:00:00.000Z" };
    const quote = { quoteId: "00000000-0000-4000-8000-000000000001", operation: "DEPOSIT", walletAddress: address, vaultAddress, vaultName: "EarnKit USDC Vault", amount: { currency: "USDC", decimals: 6, minorUnits: "1000000" }, expectedShares: "1", sharesToRedeem: null, maxWithdrawable: null, fees: { currency: "USDC", decimals: 6, minorUnits: "1" }, gasFees: [], warnings: [], policy: { status: "PASS", label: "Earn policy", reason: "Within limits." }, expiresAt: "2099-09-28T12:05:00.000Z", requiresWarningAcknowledgement: false };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => { const url = String(input); if (url.includes("/api/arc/treasury")) return { json: async () => ({ status: "READY", snapshot: { address, chain: "ARC-TESTNET", chainId: 5_042_002, balance: { currency: "USDC", minorUnits: "10000000000", decimals: 6 }, blockNumber: "42", observedAt: "2026-09-28T12:00:00.000Z" } }) }; if (url.includes("/api/earn/quote")) return { json: async () => ({ status: "READY", quote }) }; if (url.includes("/api/earn/execute")) return { json: async () => ({ status: "READY", result: { executionId: "00000000-0000-4000-8000-000000000002", operation: "DEPOSIT", status: "COMPLETE", txHash: `0x${"a".repeat(64)}`, explorerUrl: "https://testnet.arcscan.app/tx/0xabc", vaultAddress, amount: quote.amount, residualPosition: null } }) }; return { json: async () => portfolio }; }));
    const user = userEvent.setup(); renderWorkspace(<InvestmentWorkspace />);
    expect(await screen.findByText("EarnKit USDC Vault")).toBeVisible(); await user.click(screen.getByRole("button", { name: "Deposit" })); await user.type(screen.getByLabelText("Deposit amount"), "1"); await user.click(screen.getByRole("button", { name: /review fresh quote/i }));
    expect(await screen.findByText("Quote result")).toBeVisible(); const confirm = screen.getByRole("button", { name: /confirm onchain deposit/i }); expect(confirm).toBeEnabled(); await user.click(confirm); expect(await screen.findByText("Arc Testnet receipt returned.")).toBeVisible();
  });
});
