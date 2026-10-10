import { expect, test, type Page } from "@playwright/test";
import { liveSession } from "./live-session";
import { createLiveStarterWorkspace } from "../../src/lib/treasury/starter";
import type { TreasuryWorkspace } from "../../src/lib/treasury/models";

const address = "0x0000000000000000000000000000000000000001";
const recipient = "0x62dCe01b1a7B9a6f592f148d305E0D5751478386";
const usdc = (minorUnits: string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits });
const linked = (): TreasuryWorkspace => ({
  ...createLiveStarterWorkspace(), treasuryMode: "ARC_TESTNET_WALLET",
  walletConnection: { provider: "INJECTED_METAMASK", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address, label: "My wallet", connectedAt: "2026-10-09T12:00:00.000Z" },
  obligations: [{ id: "vendor-bill", title: "Vendor bill", category: "VENDOR", amount: usdc("2000000"), dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), recipient: "Vendor", priority: "NORMAL", status: "UPCOMING", description: "", recipientAddress: recipient }],
});
const chain = (key: string, label: string, domain: number, wallet: string, gateway: string) => ({ key, label, domain, nativeSymbol: "ETH", depositWait: "about 20 minutes", wallet: usdc(wallet), gateway: usdc(gateway) });

async function reads(page: Page) {
  await page.route("**/api/arc/treasury?address=*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "READY", snapshot: { address, chain: "ARC-TESTNET", chainId: 5042002, balance: usdc("10000000"), blockNumber: "42", observedAt: new Date().toISOString() } }) }));
  await page.route("**/api/earn/portfolio*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "READY", integration: { discovery: "READY", positionAccess: "READY", execution: "READ_ONLY", configuredWalletAddress: address, message: "Fixture vault discovery" }, vaults: [], positions: [], observedAt: new Date().toISOString() }) }));
  await page.route("**/api/gateway/balances?address=*", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "READY", view: {
    address, observedAt: new Date().toISOString(), gatewayStatus: "READY", unavailableChains: [],
    chains: [chain("Arc_Testnet", "Arc Testnet", 26, "10000000", "0"), chain("Base_Sepolia", "Base Sepolia", 6, "5000000", "3000000"), chain("Ethereum_Sepolia", "Ethereum Sepolia", 0, "0", "0")],
    totals: { wallet: usdc("15000000"), gateway: usdc("3000000"), all: usdc("18000000"), offArcWallet: usdc("5000000") },
  } }) }));
}

test("Overview shows USDC on every chain and opens Bring USDC to Arc", async ({ page }, testInfo) => {
  await liveSession(page, linked()); await reads(page);
  await page.goto("/");
  const card = page.getByRole("region", { name: /USDC on every chain/i }).or(page.locator("section", { hasText: "USDC on every chain" })).first();
  await expect(card).toBeVisible();
  await expect(card.getByText("18.00 USDC")).toBeVisible();
  await expect(card.getByRole("cell", { name: "Base Sepolia" })).toBeVisible();
  await expect(card.getByRole("cell", { name: "Ethereum Sepolia" })).toHaveCount(0);
  await card.getByRole("button", { name: /Show all 3 chains/ }).click();
  await expect(card.getByRole("cell", { name: "Ethereum Sepolia" })).toBeVisible();
  await card.scrollIntoViewIfNeeded(); await card.screenshot({ path: testInfo.outputPath("unified-card.png") });
  await card.getByRole("button", { name: /Bring USDC to Arc/i }).click();
  const dialog = page.getByRole("dialog", { name: "Bring USDC to Arc" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/Reconnect your wallet/)).toBeVisible();
  await expect(dialog.getByRole("combobox", { name: /Source chain/ })).toHaveValue("Base_Sepolia");
  await page.screenshot({ path: testInfo.outputPath("move-dialog.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("Obligations offer paying from a Gateway balance on another chain", async ({ page }, testInfo) => {
  await liveSession(page, linked()); await reads(page);
  await page.goto("/obligations");
  await page.getByRole("button", { name: "Pay Vendor bill from another chain" }).click();
  const dialog = page.getByRole("dialog", { name: "Pay from another chain" });
  await expect(dialog.getByText(`Arc recipient: ${recipient}`)).toBeVisible();
  await expect(dialog.getByRole("combobox")).toContainText("Base Sepolia");
  await dialog.getByRole("combobox").selectOption("Base_Sepolia");
  await expect(dialog.getByRole("button", { name: "Review payment" })).toBeEnabled();
  await page.screenshot({ path: testInfo.outputPath("pay-dialog.png") });
});

test("Autopilot page renders its closed state honestly", async ({ page }, testInfo) => {
  await liveSession(page, linked()); await reads(page);
  await page.route("**/api/autopilot/status", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "READY", mode: "PAUSED", executionEnabled: false, wallet: null, mandate: null, spentMinor: "0", returnRequested: false, balances: null, balanceError: null, runs: [], steps: [] }) }));
  await page.goto("/autopilot");
  await expect(page.getByRole("heading", { name: "Autopilot", level: 1 })).toBeVisible();
  await expect(page.getByText("Autopilot disabled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run now" })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("autopilot.png"), fullPage: true });
});
