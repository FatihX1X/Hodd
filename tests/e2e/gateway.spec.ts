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
  // One button: 2 USDC is already in Gateway on Base Sepolia, so only a free signature is needed.
  await dialog.getByLabel("Amount to move").fill("2");
  await expect(dialog.getByRole("note").filter({ hasText: "Already in Gateway on Base Sepolia" })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Bring 2 USDC to Arc" })).toBeDisabled();
  await dialog.getByLabel("Amount to move").fill("4");
  await expect(dialog.getByRole("note").filter({ hasText: "first deposits about" })).toBeVisible();
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
  await page.route("**/api/autopilot/status", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "READY", mode: "PAUSED", policyMorphoCapBps: 4000, executionEnabled: false, wallet: null, mandate: null, spentMinor: "0", returnRequested: false, balances: null, balanceError: null, runs: [], steps: [] }) }));
  await page.goto("/autopilot");
  await expect(page.getByRole("heading", { name: "Autopilot", level: 1 })).toBeVisible();
  await expect(page.getByText("Autopilot disabled")).toBeVisible();
  await expect(page.getByRole("button", { name: "Invest", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Return everything", exact: true })).toBeDisabled();
  await page.screenshot({ path: testInfo.outputPath("autopilot.png"), fullPage: true });
});


test("Autopilot returns everything with one click", async ({ page }) => {
  await liveSession(page, linked()); await reads(page);
  const run = { id: "return-run", state: "RUNNING", decision: { kind: "RETURN_ALL", depositMinor: "0", withdrawMinor: "7969330", transferMinor: "19980000", remainingBudgetMinor: "0", protectedMinor: "0", explanation: "Return all agent funds to your wallet." }, failure: null, created_at: "2026-10-11T12:00:00.000Z" };
  let started = false;
  let completed = false;
  let returns = 0;
  let polls = 0;
  const hash = "0x" + "a".repeat(64);
  await page.route("**/api/autopilot/status", async route => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON()).toEqual({});
      polls++; completed = true;
      await route.fulfill({ json: { status: "READY", run: { ...run, state: "COMPLETED" } } }); return;
    }
    await route.fulfill({ json: { status: "READY", mode: "ACTIVE", executionEnabled: true, policyMorphoCapBps: 4000,
      wallet: { address: recipient, owner_address: address, account_type: "EOA" }, mandate: null, spentMinor: "0", returnRequested: started,
      balances: { cashMinor: completed ? "0" : "12000000", positionMinor: completed ? "0" : "7969330", redeemableMinor: "7969330", observedAt: "2026-10-11T12:00:00.000Z" }, balanceError: null,
      runs: started ? [{ ...run, state: completed ? "COMPLETED" : "RUNNING" }] : [],
      steps: started ? [{ id: "return-step", run_id: run.id, stage: completed ? "TRANSFER" : "EARN", state: completed ? "COMPLETED" : "PENDING", tx_hash: completed ? hash : null, circle_transaction_id: null }] : [],
    } });
  });
  await page.route("**/api/autopilot/return-all", async route => {
    expect(route.request().method()).toBe("POST");
    expect(route.request().postDataJSON()).toEqual({ phase: "now" });
    returns++; started = true;
    await route.fulfill({ json: { status: "READY", run } });
  });
  await page.goto("/autopilot");
  await expect(page.getByRole("button", { name: "Return everything", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Return everything", exact: true }).click();
  await page.getByRole("button", { name: "Confirm?" }).click();
  const rail = page.getByRole("region", { name: "Return progress" });
  await expect(rail).toContainText("Done. 19.98 USDC sent to your wallet.", { timeout: 15_000 });
  await expect(rail.getByRole("link", { name: /Open transaction/ })).toHaveAttribute("href", "https://testnet.arcscan.app/tx/" + hash);
  expect(returns).toBe(1); expect(polls).toBe(1);
});

test("Autopilot shows the user's vault, its limits and the bills it pays", async ({ page }, testInfo) => {
  await liveSession(page, linked()); await reads(page);
  const vault = "0x4cE19EAbc6F38fb95030E400A50abac0f4f12B88";
  await page.route("**/api/autopilot/status", (route) => route.fulfill({ json: { status: "READY", mode: "TESTNET_LIVE", executionEnabled: true, policyMorphoCapBps: 4000,
    wallet: { address: recipient, owner_address: address, account_type: "EOA" }, mandate: { budgetMinor: "10000000", reserveMinor: "0", maxPerRunMinor: "10000000", maxMorphoBps: 4000, enabled: true, paused: false }, spentMinor: "12000", returnRequested: false,
    balances: { cashMinor: "6000000", positionMinor: "4000000", redeemableMinor: "4000000", observedAt: new Date().toISOString() }, balanceError: null, runs: [], steps: [],
    vault: { address: vault, deployed: true, factory: "0x311578B21F269ca0E45f5c16324A3E51f69ce389", paused: false, limits: { maxDepositPerTxMinor: "1000000000", depositLimit24hMinor: "2000000000", maxPaymentPerTxMinor: "1000000000", paymentLimit24hMinor: "2000000000" }, agentGasMinor: "480000" },
    bills: [{ id: "vendor-bill", title: "Vendor bill", amountMinor: "2000000", dueAt: new Date(Date.now() + 5 * 86_400_000).toISOString(), recipient, capMinor: "0", plan: "NEEDS_APPROVAL", payFrom: null }],
    needsYou: [{ code: "APPROVE_BILLS", message: "One bill needs your approval before Autopilot can pay it." }] } }));
  await page.goto("/autopilot");
  await expect(page.getByRole("heading", { name: "Your vault" })).toBeVisible();
  await expect(page.getByRole("link", { name: /0x4cE1/ })).toHaveAttribute("href", "https://testnet.arcscan.app/address/" + vault);
  await expect(page.getByRole("button", { name: "Let Autopilot pay Vendor bill" })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Needs you" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("autopilot-vault.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
