import { expect, test } from "@playwright/test";

const routes = [["/", "Liquidity before yield."], ["/invest", "Review idle capital."], ["/obligations", "Know what is due."], ["/activity", "Every decision leaves a trace."]] as const;
for (const [route, heading] of routes) {
  test(`${route} renders without console errors or horizontal overflow`, async ({ page }) => {
    const errors: string[] = []; page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(route); await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByRole("note")).toContainText(/local demo workspace|changes persist|apys remain|entries are stored/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false); expect(errors).toEqual([]);
  });
}

test("obligation create, edit and persistence recalculate capital", async ({ page }) => {
  await page.goto("/obligations"); await page.getByRole("button", { name: /new obligation/i }).click();
  await page.getByLabel("Obligation title").fill("Urgent invoice"); await page.getByLabel("Obligation amount").fill("2000"); await page.getByLabel("Due date").fill("2026-09-28");
  await page.getByRole("button", { name: /save and recalculate/i }).click();
  await expect(page.getByText("6,500.00 USDC")).toBeVisible(); await expect(page.getByText("2,500.00 USDC")).toBeVisible();
  await page.reload(); await expect(page.getByText("Urgent invoice")).toBeVisible();
  await page.getByRole("button", { name: "Edit Urgent invoice" }).click(); await page.getByLabel("Obligation amount").fill("2500"); await page.getByRole("button", { name: /save and recalculate/i }).click();
  await expect(page.getByText("7,000.00 USDC")).toBeVisible(); await expect(page.getByText("Deployable capital").locator("..").getByText("2,000.00 USDC")).toBeVisible();
});

test("policy changes persist and update engine metrics", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: /edit policy/i }).click(); await page.getByLabel("Safety buffer").fill("1500"); await page.getByRole("button", { name: /save policy and recalculate/i }).click();
  await expect(page.getByText("4,000.00 USDC", { exact: true })).toBeVisible(); await page.reload(); await expect(page.getByText("4,000.00 USDC", { exact: true })).toBeVisible();
});

test("investment target validation and preview remain non-executable", async ({ page }) => {
  await page.goto("/invest"); await page.getByLabel("Morpho target").fill("40"); await page.getByRole("button", { name: /save targets/i }).click(); await expect(page.getByText(/target allocations must total exactly 100%/i)).toBeVisible();
  const trigger = page.getByRole("button", { name: /preview engine plan/i }); await trigger.click(); await expect(page.getByRole("dialog", { name: /allocation plan/i })).toBeVisible(); await expect(page.getByRole("button", { name: /execution begins/i })).toBeDisabled(); await page.getByRole("button", { name: /close investment preview/i }).click(); await expect(trigger).toBeFocused();
});

test("corrupt storage fails closed and can be reset", async ({ page }) => {
  await page.goto("/"); await page.evaluate(() => localStorage.setItem("hodd.stage3.workspace.v2", "not-json")); await page.reload();
  const recovery = page.getByRole("alert").filter({ hasText: "No saved value was used" }); await expect(recovery).toBeVisible(); await page.getByRole("button", { name: /reset demo workspace/i }).click(); await expect(recovery).toHaveCount(0);
});

test("portfolio reflows at the 200 percent equivalent viewport", async ({ page }) => { await page.setViewportSize({ width: 640, height: 900 }); await page.goto("/"); expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false); await expect(page.getByRole("heading", { name: "Liquidity before yield." })).toBeVisible(); });
test("activity details are keyboard accessible", async ({ page }) => { await page.goto("/activity"); const disclosure = page.locator("summary").filter({ hasText: "Treasury Engine baseline evaluated" }).first(); await disclosure.focus(); await disclosure.press("Enter"); await expect(page.getByText("Why this record exists").first()).toBeVisible(); });

test("a linked wallet makes verified Arc USDC authoritative without enabling execution", async ({ page }) => {
  await page.route("**/api/arc/treasury?address=*", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "READY", snapshot: { address: "0x0000000000000000000000000000000000000001", chain: "ARC-TESTNET", chainId: 5_042_002, balance: { currency: "USDC", minorUnits: "20000000", decimals: 6 }, blockNumber: "42", observedAt: "2026-09-27T12:00:00.000Z" } }) }));
  await page.goto("/"); const trigger = page.getByRole("button", { name: /connect wallet/i }); await trigger.click(); await page.getByLabel("Public Arc Testnet address").fill("0x0000000000000000000000000000000000000001"); await page.getByRole("button", { name: /link public address/i }).click();
  await expect(page.getByText("20.00 USDC").first()).toBeVisible(); await expect(page.getByText(/signing: disabled/i)).toBeVisible(); await expect(page.getByText(/execution: disabled/i)).toBeVisible(); await expect(page.getByText("AT RISK")).toBeVisible();
  await page.reload(); await expect(page.getByText("20.00 USDC").first()).toBeVisible();
});
