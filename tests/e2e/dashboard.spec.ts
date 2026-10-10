import { expect, test } from "@playwright/test";
import { liveSession } from "./live-session";
import { createLiveStarterWorkspace } from "../../src/lib/treasury/starter";
import { sampleWorkspace, usdc } from "@/test/fixtures";
import type { TreasuryWorkspace } from "../../src/lib/treasury/models";

const address = "0x0000000000000000000000000000000000000001";
const linkedWorkspace = (): TreasuryWorkspace => ({ ...createLiveStarterWorkspace(), treasuryMode: "ARC_TESTNET_WALLET", walletConnection: { provider: "INJECTED_METAMASK", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address, label: "My wallet", connectedAt: "2026-10-09T12:00:00.000Z" } });
async function liveReads(page: import("@playwright/test").Page, minorUnits = "10000000000") {
  await page.route("**/api/arc/treasury?address=*", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "READY", snapshot: { address, chain: "ARC-TESTNET", chainId: 5042002, balance: usdc(minorUnits), blockNumber: "42", observedAt: "2026-10-09T12:00:00.000Z" } }) }));
  await page.route("**/api/earn/portfolio*", async (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ status: "READY", integration: { discovery: "READY", positionAccess: "READY", execution: "READ_ONLY", configuredWalletAddress: address, message: "Live fixture vault discovery" }, vaults: [], positions: [], observedAt: "2026-10-09T12:00:00.000Z" }) }));
}

const routes = ["/", "/invest", "/obligations", "/policy", "/activity", "/connections", "/hoddie"];
for (const route of routes) {
  test(route + " defaults to the signed-out live welcome gate without fake data or overflow", async ({ page }) => {
    const errors: string[] = []; page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.goto(route);
    await expect(page.getByRole("heading", { name: "Sign in to start a live testnet treasury", level: 1 })).toBeVisible();
    await expect(page.getByRole("main").getByRole("link", { name: "Sign in", exact: true })).toHaveAttribute("href", "/login");
    await expect(page.getByRole("link", { name: "Circle testnet faucet", exact: true })).toHaveAttribute("href", "https://faucet.circle.com");
    await expect(page.getByText("October payroll", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/10,000/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: /choose wallet|new obligation/i })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    expect(errors).toEqual([]);
  });
}



test("corrupt guest storage never becomes a live financial source", async ({ page }) => {
  await page.goto("/"); await page.evaluate(() => localStorage.setItem("hodd.stage5.workspace.v4", "not-json")); await page.reload();
  await expect(page.getByRole("heading", { name: "Sign in to start a live testnet treasury" })).toBeVisible();
  await expect(page.getByText(/10,000/)).toHaveCount(0);
});

test("live welcome reflows at the 200 percent equivalent viewport", async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 900 }); await page.goto("/");
  await expect(page.getByRole("heading", { name: "Sign in to start a live testnet treasury" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
});

test("signed-in users start empty and get onboarding without any stored sample totals", async ({ page }) => {
  const session = await liveSession(page); await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your live testnet treasury", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Get free testnet USDC", exact: true })).toHaveAttribute("href", "https://faucet.circle.com");
  await expect(page.getByText("Choose Arc Testnet in the Circle faucet.")).toBeVisible();
  await expect(page.getByText(/10,000/)).toHaveCount(0); await expect(page.getByText("October payroll", { exact: true })).toHaveCount(0);
  expect(session.getWorkspace().obligations).toEqual([]); expect(session.getWorkspace().totalTreasury.minorUnits).toBe("0");
});

test("obligation create, edit, persistence and delete recalculate live capital", async ({ page }) => {
  test.setTimeout(60_000);
  const session = await liveSession(page, linkedWorkspace()); await liveReads(page); await page.goto("/obligations");
  await page.getByRole("button", { name: "New obligation", exact: true }).click();
  await page.getByLabel("Obligation title").fill("Urgent invoice"); await page.getByLabel("Obligation amount").fill("2000"); await page.getByLabel("Due date").fill("2026-10-09"); await page.getByRole("button", { name: /save and recalculate/i }).click();
  await expect(page.getByText("2,001.00 USDC", { exact: true })).toBeVisible(); await expect(page.getByText("7,999.00 USDC", { exact: true })).toBeVisible();
  await expect.poll(() => session.getWorkspace().obligations[0]?.amount.minorUnits).toBe("2000000000");
  await page.reload(); await expect(page.getByRole("heading", { name: "Urgent invoice", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit Urgent invoice" }).click(); await page.getByLabel("Obligation amount").fill("2500"); await page.getByRole("button", { name: /save and recalculate/i }).click();
  await expect(page.getByText("2,501.00 USDC", { exact: true })).toBeVisible(); await expect(page.getByText("7,499.00 USDC", { exact: true })).toBeVisible();
  await expect.poll(() => session.getWorkspace().obligations[0]?.amount.minorUnits).toBe("2500000000");
  await page.getByRole("button", { name: "Delete Urgent invoice" }).click(); await page.getByRole("button", { name: "Confirm deletion" }).click(); await expect(page.getByRole("heading", { name: "Urgent invoice", exact: true })).toHaveCount(0);
  await expect.poll(() => session.getWorkspace().obligations).toEqual([]);
  await page.reload(); await expect(page.getByRole("heading", { name: "Urgent invoice", exact: true })).toHaveCount(0);
});

test("a server-rejected deletion keeps the bill and explains its payment history", async ({ page }) => {
  const workspace = linkedWorkspace(); workspace.obligations.push({ id: "my-bill", title: "Keep my audit trail", amount: usdc("2000000"), dueAt: "2026-10-09T17:00:00.000Z", category: "VENDOR", priority: "NORMAL", status: "UPCOMING", recipient: null, description: "" });
  const session = await liveSession(page, workspace); session.rejectDeletion(); await liveReads(page); await page.goto("/obligations");
  await page.getByRole("button", { name: "Delete Keep my audit trail" }).click(); await page.getByRole("button", { name: "Confirm deletion" }).click();
  await expect(page.getByRole("alert")).toContainText("This bill has payment history and cannot be deleted");
  await page.getByRole("button", { name: "Cancel", exact: true }).click(); await expect(page.getByRole("heading", { name: "Keep my audit trail", exact: true })).toBeVisible();
});

test("policy changes persist and update live engine metrics", async ({ page }) => {
  await liveSession(page, linkedWorkspace()); await liveReads(page); await page.goto("/");
  await page.getByRole("button", { name: "Edit policy", exact: true }).click(); await page.getByLabel("Safety buffer", { exact: true }).fill("1500"); await page.getByRole("button", { name: /save policy and recalculate/i }).click();
  await expect(page.getByRole("main").getByText("8.5K USDC", { exact: true })).toBeVisible(); await page.reload(); await expect(page.getByRole("main").getByText("8.5K USDC", { exact: true })).toBeVisible();
});

test("live investment targets validate and unsupported strategies stay at zero", async ({ page }) => {
  await liveSession(page, linkedWorkspace()); await liveReads(page); await page.goto("/invest");
  await expect(page.getByLabel("USYC target", { exact: true })).toBeDisabled(); await expect(page.getByLabel("USYC target", { exact: true })).toHaveValue("0");
  await expect(page.getByLabel("BTC Reserve target", { exact: true })).toBeDisabled();
  await page.getByLabel("Morpho target", { exact: true }).fill("40"); await page.getByRole("button", { name: "Save targets", exact: true }).click(); await expect(page.getByRole("main").getByRole("alert")).toContainText("exactly 100%");
});

test("wallet selection supports all user-owned providers and restores focus", async ({ page }) => {
  await liveSession(page); await page.goto("/"); const trigger = page.getByRole("button", { name: /choose wallet/i }); await trigger.click();
  for (const name of ["Circle Passkey", "Circle Embedded", "Browser wallet"]) await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "MetaMask", exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: "Rabby", exact: true })).toBeVisible();
  await page.getByRole("button", { name: /close wallet dialog/i }).click(); await expect(trigger).toBeFocused();
});

test("browser wallet connection uses its own balance and survives refresh as public metadata", async ({ page }) => {
  await liveSession(page); await liveReads(page, "20000000");
  await page.addInitScript(({ address }) => { Object.defineProperty(window, "ethereum", { value: { isMetaMask: true, request: async ({ method }: { method: string }) => { if (method === "eth_chainId") return "0x4cef52"; if (method === "eth_accounts" || method === "eth_requestAccounts") return [address]; throw new Error(`Unexpected wallet request: ${method}`); }, on: () => undefined, removeListener: () => undefined } }); }, { address });
  await page.goto("/"); await page.getByRole("button", { name: /choose wallet/i }).click(); await page.getByRole("button", { name: "MetaMask", exact: true }).click();
  await expect(page.getByText("Custody: user")).toBeVisible(); await expect(page.getByText("20.00 USDC").first()).toBeVisible();
  await page.reload(); await expect(page.getByText("20.00 USDC").first()).toBeVisible(); await expect(page.getByText("Signer session: reconnect required")).toBeVisible();
});

test("policy page explains and saves the same live workspace policy", async ({ page }) => {
  await liveSession(page); await page.goto("/policy"); await expect(page.getByText(/place at most 60% in morpho/i)).toBeVisible();
  await page.getByLabel("Safety buffer", { exact: true }).fill("1500"); await page.getByRole("button", { name: /save policy and recalculate/i }).click();
  await expect(page.getByText(/1,500.00 USDC safety buffer/)).toBeVisible(); await page.reload(); await expect(page.getByText(/1,500.00 USDC safety buffer/)).toBeVisible();
});





test("production execution routes fail closed even with the development flag", async ({ request }) => {
  for (const path of ["/api/payments", "/api/earn/quote", "/api/earn/execute", "/api/earn/execution", "/api/circle-proxy/v1/w3s/user/transactions/transfer"]) {
    const response = await request.post(path, { data: {} }); expect(response.status()).toBe(403);
  }
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

test("obsolete demo preferences keep visitors at the sign-in gate", async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem("hodd:workspace-mode", "DEMO"));
  await page.goto("/?demo=1");
  await expect(page.getByRole("heading", { name: "Sign in to start a live testnet treasury" })).toBeVisible();
  await expect(page.getByText(/10,000/)).toHaveCount(0);
});

test("legacy cleanup runs automatically once and preserves paid and user bills", async ({ page }) => {
  const workspace = structuredClone(sampleWorkspace);
  workspace.obligations[0].status = "PAID";
  workspace.obligations.push({ ...workspace.obligations[1], id: "my-bill", title: "My bill" });
  const session = await liveSession(page, workspace); await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your live testnet treasury", exact: true })).toBeVisible();
  await expect.poll(() => session.getWorkspace().obligations.map(item => item.id)).toEqual([workspace.obligations[0].id, "my-bill"]);
  expect(session.getWorkspace().activities).toEqual([expect.objectContaining({ actor: "SYSTEM", action: "Sample records removed" })]);
  expect(session.getWorkspace().policy.safetyBuffer.minorUnits).toBe("1000000");
  expect(session.getWriteCount()).toBe(1);
  await page.reload(); await expect(page.getByRole("heading", { name: "Your live testnet treasury", exact: true })).toBeVisible();
  expect(session.getWriteCount()).toBe(1);
});
