import { existsSync, readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import type { Hex } from "viem";
import { installTestWallet } from "./test-wallet";

// Live Arc Testnet run against a real deployment (default: production). Moves
// testnet USDC only, inside the isolated smoke workspace (max 1 USDC each).
// Run: corepack pnpm exec playwright test -c playwright.live.config.ts
const STATE = ".playwright-live/state.json";
const RECIPIENT = process.env.LIVE_RECIPIENT ?? "0x3406584CCD8cc2fa38BfD3ece96d5dD4371B0040";

function testKey(): Hex {
  for (const line of readFileSync(".env.development.local", "utf8").split(/\r?\n/)) {
    const match = /^HODD_TEST_SIGNER_PRIVATE_KEY=["']?(0x[\da-fA-F]{64})["']?$/.exec(line.trim());
    if (match) return match[1] as Hex;
  }
  throw new Error("HODD_TEST_SIGNER_PRIVATE_KEY missing in .env.development.local");
}
const dialogText = (page: Page) => page.getByRole("dialog").innerText();
async function untilDone(page: Page, label: string) {
  await expect.poll(async () => { const text = await dialogText(page); if (/FAILED|UNKNOWN|did not complete|unknown/i.test(text) && !/COMPLETE|CONFIRMED/.test(text)) throw new Error(`${label}: ${text.slice(-600)}`); return /\bCOMPLETE\b|\bCONFIRMED\b/.test(text); }, { timeout: 180_000, intervals: [2_000] }).toBe(true);
}

test.describe.configure({ mode: "serial" });

test("sign in once (manual, only when no saved session)", async ({ browser }) => {
  test.skip(existsSync(STATE), "saved session present");
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/login");
  // The owner signs in by hand in this window; no credential is typed by the test.
  await expect(page.getByRole("button", { name: /sign out/i })).toBeVisible({ timeout: 600_000 });
  await context.storageState({ path: STATE });
});

test("deposit, withdraw, redeem and pay with a live EOA wallet", async ({ browser }) => {
  const context = await browser.newContext({ storageState: STATE });
  const page = await context.newPage();
  const address = await installTestWallet(page, testKey());
  await page.goto("/?smoke=1");
  const toSmoke = page.getByRole("button", { name: "Open isolated smoke workspace" });
  if (await toSmoke.isVisible().catch(() => false)) await toSmoke.click();
  await expect(page.getByText(/SMOKE-TEST WORKSPACE/)).toBeVisible();

  // Connect as MetaMask (replaces any previous smoke wallet session) and prove ownership.
  const disconnect = page.getByRole("button", { name: "Disconnect" });
  if (await disconnect.isVisible().catch(() => false)) await disconnect.click();
  await page.getByRole("button", { name: "Choose wallet" }).click();
  await page.getByRole("button", { name: "MetaMask", exact: true }).click();
  await expect(page.getByText(address.slice(0, 8))).toBeVisible({ timeout: 30_000 });
  const verify = page.getByRole("button", { name: "Verify wallet" });
  if (await verify.isVisible({ timeout: 10_000 }).catch(() => false)) { await verify.click(); await expect(page.getByText("Ownership verified")).toBeVisible({ timeout: 30_000 }); }

  // In-app navigation keeps the in-memory signer.
  await page.getByRole("link", { name: "Strategies" }).first().click();
  for (const [operation, amount] of [["Deposit", "0.5"], ["Withdraw", "0.25"], ["Redeem all", null]] as const) {
    await page.getByRole("button", { name: operation, exact: true }).click();
    if (amount) await page.getByLabel(`${operation} amount`).fill(amount);
    await page.getByRole("button", { name: "Review fresh quote" }).click();
    await page.getByRole("button", { name: new RegExp(`^Confirm onchain ${operation.toLowerCase()}`) }).click({ timeout: 60_000 });
    await untilDone(page, operation);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(4_000);
  }

  // A 0.10 USDC bill to the owner's own test address, paid in full.
  await page.getByRole("link", { name: "Obligations" }).first().click();
  await page.getByRole("button", { name: /new obligation/i }).click();
  const title = `Live smoke ${Date.now()}`;
  await page.getByLabel("Obligation title").fill(title);
  await page.getByLabel("Obligation amount").fill("0.1");
  await page.getByLabel("Due date").fill(new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10));
  await page.getByLabel("Recipient address").fill(RECIPIENT);
  await page.getByRole("dialog").getByRole("combobox").last().selectOption("UPCOMING");
  await page.getByRole("button", { name: "Save and recalculate" }).click();
  await page.getByRole("button", { name: `Review payment for ${title}` }).click();
  await page.getByRole("button", { name: "Review fresh payment proposal" }).click();
  await page.getByRole("button", { name: "Confirm full testnet payment" }).click({ timeout: 60_000 });
  await untilDone(page, "Payment");
  await context.close();
});
