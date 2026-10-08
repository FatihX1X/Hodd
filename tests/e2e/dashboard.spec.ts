import { expect, test } from "@playwright/test";

const earnReadOnlyResponse = { status: "READY", integration: { discovery: "READY", positionAccess: "NOT_CONFIGURED", execution: "READ_ONLY", configuredWalletAddress: null, message: "Live vault discovery; wallet credentials are not configured." }, vaults: [], positions: [], observedAt: "2026-09-28T12:00:00.000Z" };
test.beforeEach(async ({ page }) => { await page.route("**/api/earn/portfolio*", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify(earnReadOnlyResponse) })); });

const routes = [["/", "Liquidity before yield."], ["/invest", "Deploy idle capital deliberately."], ["/obligations", "Know what is due."], ["/policy", "The rules behind every number."], ["/activity", "Every decision leaves a trace."], ["/connections", "Ask Hodd from Claude."]] as const;
for (const [route, heading] of routes) {
  test(`${route} renders without console errors or horizontal overflow`, async ({ page }) => {
    const errors: string[] = []; page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(route); await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByRole("note")).toContainText(/local demo workspace|changes persist|vault data is live|policy values change|quotes and approvals|connector uses your hodd sign-in/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false); expect(errors).toEqual([]);
  });
}

test("obligation create, edit and persistence recalculate capital", async ({ page }) => {
  await page.goto("/obligations"); await page.getByRole("button", { name: /new obligation/i }).click();
  await page.getByLabel("Obligation title").fill("Urgent invoice"); await page.getByLabel("Obligation amount").fill("2000"); await page.getByLabel("Due date").fill("2026-09-28");
  await page.getByRole("button", { name: /save and recalculate/i }).click();
  await expect(page.getByText("6,500.00 USDC")).toBeVisible(); await expect(page.getByText("2,500.00 USDC")).toBeVisible();
  await page.reload(); await expect(page.getByRole("heading", { name: "Urgent invoice", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Urgent invoice" }).click(); await page.getByLabel("Obligation amount").fill("2500"); await page.getByRole("button", { name: /save and recalculate/i }).click();
  await expect(page.getByText("7,000.00 USDC")).toBeVisible(); await expect(page.getByText("Deployable capital").locator("..").getByText("2,000.00 USDC")).toBeVisible();
});

test("policy changes persist and update engine metrics", async ({ page }) => {
  await page.goto("/"); await page.getByRole("button", { name: /edit policy/i }).click(); await page.getByLabel("Safety buffer").fill("1500"); await page.getByRole("button", { name: /save policy and recalculate/i }).click();
  await expect(page.getByRole("main").getByText("4,000.00 USDC", { exact: true })).toBeVisible(); await page.reload(); await expect(page.getByRole("main").getByText("4,000.00 USDC", { exact: true })).toBeVisible();
});

test("investment target validation and preview remain non-executable", async ({ page }) => {
  await page.goto("/invest"); await page.getByLabel("Morpho target").fill("40"); await page.getByRole("button", { name: /save targets/i }).click(); await expect(page.getByText(/target allocations must total exactly 100%/i)).toBeVisible();
  const trigger = page.getByRole("button", { name: /preview engine plan/i }); await trigger.click(); await expect(page.getByRole("dialog", { name: /allocation plan/i })).toBeVisible(); await expect(page.getByRole("button", { name: /execution begins/i })).toBeDisabled(); await page.getByRole("button", { name: /close investment preview/i }).click(); await expect(trigger).toBeFocused();
});

test("corrupt storage fails closed and can be reset", async ({ page }) => {
  await page.goto("/"); await page.evaluate(() => localStorage.setItem("hodd.stage5.workspace.v4", "not-json")); await page.reload();
  const recovery = page.getByRole("alert").filter({ hasText: "No saved value was used" }); await expect(recovery).toBeVisible(); await page.getByRole("button", { name: /reset demo workspace/i }).click(); await expect(recovery).toHaveCount(0);
});

test("portfolio reflows at the 200 percent equivalent viewport", async ({ page }) => { await page.setViewportSize({ width: 640, height: 900 }); await page.goto("/"); expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false); await expect(page.getByRole("heading", { name: "Liquidity before yield." })).toBeVisible(); });
test("activity details are keyboard accessible", async ({ page }) => { await page.goto("/activity"); const disclosure = page.locator("summary").filter({ hasText: "Treasury Engine baseline evaluated" }).first(); await disclosure.focus(); await disclosure.press("Enter"); await expect(page.getByText("Why this record exists").first()).toBeVisible(); });

test("wallet selection supports all user-owned providers", async ({ page }) => {
  await page.goto("/"); const trigger = page.getByRole("button", { name: /choose wallet/i }); await trigger.click();
  for (const name of ["Circle Passkey", "Circle Embedded", "Browser wallet"]) await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "MetaMask" })).toBeVisible(); await expect(page.getByRole("button", { name: "Rabby" })).toBeVisible();
  await page.getByRole("button", { name: /close wallet dialog/i }).click(); await expect(trigger).toBeFocused();
});
test("production execution routes fail closed even with the development flag", async ({ request }) => {
  for (const path of ["/api/payments", "/api/earn/quote", "/api/earn/execute", "/api/earn/execution", "/api/circle-proxy/v1/w3s/user/transactions/transfer"]) {
    const response = await request.post(path, { data: {} }); expect(response.status()).toBe(403);
  }
});

test("browser wallet connection uses its account balance and survives refresh as read-only metadata", async ({ page }) => {
  const address = "0x0000000000000000000000000000000000000001";
  await page.addInitScript(({ address }) => {
    Object.defineProperty(window, "ethereum", { value: {
      isMetaMask: true,
      request: async ({ method }: { method: string }) => {
        if (method === "eth_chainId") return "0x4cef52";
        if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
        throw new Error(`Unexpected wallet request: ${method}`);
      },
      on: () => undefined,
      removeListener: () => undefined,
    } });
  }, { address });
  await page.route("**/api/arc/treasury?address=*", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "READY", snapshot: { address, chain: "ARC-TESTNET", chainId: 5_042_002, balance: { currency: "USDC", minorUnits: "20000000", decimals: 6 }, blockNumber: "42", observedAt: "2026-09-30T12:00:00.000Z" } }) }));
  await page.goto("/"); await page.getByRole("button", { name: /choose wallet/i }).click(); await page.getByRole("button", { name: "MetaMask" }).click();
  await expect(page.getByText("Custody: user")).toBeVisible(); await expect(page.getByText("20.00 USDC").first()).toBeVisible();
  await page.reload(); await expect(page.getByText("20.00 USDC").first()).toBeVisible(); await expect(page.getByText("Signer session: reconnect required")).toBeVisible();
});

test("Claude connector endpoint requires OAuth and advertises its exact resource", async ({ request }) => {
  const unauthenticated = await request.post("/api/mcp", { data: { jsonrpc: "2.0", id: 1, method: "tools/list" } });
  expect(unauthenticated.status()).toBe(401);
  expect(unauthenticated.headers()["www-authenticate"]).toContain("/.well-known/oauth-protected-resource/api/mcp");
  const metadata = await (await request.get("/.well-known/oauth-protected-resource/api/mcp")).json();
  expect(metadata.resource).toMatch(/\/api\/mcp$/);
  expect(metadata.authorization_servers[0]).toMatch(/\/auth\/v1$/);
});

test("OAuth consent keeps the request across sign-in", async ({ page }) => {
  await page.goto("/oauth/consent?authorization_id=test-authorization-123");
  await expect(page).toHaveURL(/\/login$/);
  const cookie = (await page.context().cookies()).find((item) => item.name === "hodd_after_login");
  expect(decodeURIComponent(cookie?.value ?? "")).toBe("/oauth/consent?authorization_id=test-authorization-123");
});

test("policy page states the rules and edits the same persisted policy", async ({ page }) => {
  await page.goto("/policy");
  await expect(page.getByText(/place at most 60% in morpho/i)).toBeVisible();
  await page.getByLabel("Safety buffer").fill("1500"); await page.getByRole("button", { name: /save policy and recalculate/i }).click();
  await expect(page.getByText(/1,500.00 USDC safety buffer/)).toBeVisible(); await page.reload(); await expect(page.getByText(/1,500.00 USDC safety buffer/)).toBeVisible();
});

test("obligation detail follows the selected row and charts reveal values only on hover", async ({ page }) => {
  await page.goto("/obligations");
  const plan = page.getByRole("complementary", { name: "Payment plan" }); await expect(plan).toContainText(/plan for october payroll/i);
  await page.getByRole("button", { name: "AWS infrastructure", exact: true }).click(); await expect(plan).toContainText(/plan for aws infrastructure/i);
  await expect(page.getByRole("status")).toHaveCount(0);
});
