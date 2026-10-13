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

test("MetaMask connects through EIP-6963 while Rabby owns window.ethereum (Brave with both installed)", async ({ page }) => {
  await liveSession(page); await liveReads(page, "20000000");
  await page.addInitScript(({ address }) => {
    const wallet = (name: string, flags: object) => ({ ...flags, request: async ({ method }: { method: string }) => { (window as unknown as { asked: string[] }).asked.push(`${name}:${method}`); if (method === "eth_chainId") return "0x4cef52"; if (method === "eth_accounts" || method === "eth_requestAccounts") return [address]; throw new Error(`Unexpected wallet request: ${method}`); }, on: () => undefined, removeListener: () => undefined });
    (window as unknown as { asked: string[] }).asked = [];
    const rabby = wallet("rabby", { isRabby: true, isMetaMask: true }); const metamask = wallet("metamask", { isMetaMask: true });
    Object.defineProperty(window, "ethereum", { value: rabby });
    // Like the real extensions: announce on load and whenever a dapp asks.
    const announce = () => { for (const [rdns, provider] of [["io.rabby", rabby], ["io.metamask", metamask]] as const) window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: rdns, name: rdns, icon: "data:,", rdns }, provider }) })); };
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { address });
  await page.goto("/"); await page.getByRole("button", { name: /choose wallet/i }).click(); await page.getByRole("button", { name: "MetaMask", exact: true }).click();
  await expect(page.getByText("Custody: user")).toBeVisible();
  const asked = await page.evaluate(() => (window as unknown as { asked: string[] }).asked);
  expect(asked).toContain("metamask:eth_requestAccounts"); expect(asked.filter((item) => item.startsWith("rabby:"))).toEqual([]);
});

test("Autopilot Invest signs with MetaMask inside the server's gas ceiling and never calls the Arc RPC from the browser", async ({ page }) => {
  await liveSession(page); await liveReads(page, "20000000");
  const hash = "0x" + "c".repeat(64), agent = "0x00000000000000000000000000000000000000ab";
  await page.addInitScript(({ address, hash }) => {
    const sent: unknown[] = []; (window as unknown as { sent: unknown[] }).sent = sent;
    Object.defineProperty(window, "ethereum", { value: { isMetaMask: true, request: async ({ method, params }: { method: string; params?: unknown[] }) => { if (method === "eth_chainId") return "0x4cef52"; if (method === "eth_accounts" || method === "eth_requestAccounts") return [address]; if (method === "eth_sendTransaction") { sent.push(params?.[0]); return hash; } throw new Error(`Unexpected wallet request: ${method}`); }, on: () => undefined, removeListener: () => undefined } });
  }, { address, hash });
  let done = false; const calls: string[] = [];
  const status = () => ({ status: "READY", mode: "TESTNET_LIVE", executionEnabled: true, policyMorphoCapBps: 6000, wallet: { address: agent, owner_address: address, account_type: "EOA" }, mandate: null, spentMinor: "0", returnRequested: false, balances: { cashMinor: done ? "6000000" : "0", positionMinor: done ? "9000000" : "0", redeemableMinor: "0", observedAt: "2026-10-11T12:00:00.000Z" }, balanceError: null, runs: done ? [{ id: "run", state: "COMPLETED", decision: { kind: "INVEST", depositMinor: "9000000", withdrawMinor: "0", transferMinor: "0", explanation: "Invest" }, failure: null, created_at: "2026-10-11T12:00:00.000Z" }] : [], steps: [] });
  await page.route("**/api/autopilot/**", async (route) => {
    const action = new URL(route.request().url()).pathname.split("/").at(-1)!;
    if (route.request().method() === "GET") return route.fulfill({ json: status() });
    calls.push(action);
    if (action === "invest") return route.fulfill({ json: { status: "READY", agentAddress: agent, funding: { call: { to: "0x3600000000000000000000000000000000000000", data: "0xa9059cbb", value: "0" }, gasBudgetWei: (59_206n * 50_000_000_000n).toString(), gasCeiling: { gasLimit: "59206", gasPriceWei: "50000000000" }, amountMinor: "15000000" } } });
    if (action === "funding") { expect(route.request().postDataJSON()).toEqual({ txHash: hash }); return route.fulfill({ json: { status: "ARRIVED", amountMinor: "15000000" } }); }
    if (action === "run") return route.fulfill({ json: { status: "READY", run: { id: "run", state: "RUNNING", decision: { kind: "INVEST", depositMinor: "9000000", withdrawMinor: "0", transferMinor: "0", explanation: "Invest" }, failure: null, created_at: "2026-10-11T12:00:00.000Z" } } });
    done = true; return route.fulfill({ json: { status: "READY", run: null } });
  });
  await page.goto("/"); await page.getByRole("button", { name: /choose wallet/i }).click(); await page.getByRole("button", { name: "MetaMask", exact: true }).click();
  await expect(page.getByText("Custody: user")).toBeVisible();
  // In-app navigation keeps the in-memory signer.
  await page.getByRole("link", { name: "Autopilot" }).first().click();
  const rpc: string[] = []; page.on("request", (request) => { if (/rpc\.testnet\.arc/.test(request.url())) rpc.push(request.url()); });
  await page.getByLabel("Amount (USDC)").fill("15"); await page.getByRole("button", { name: "Invest 15 USDC" }).click();
  await expect(page.getByRole("region", { name: "Invest progress" })).toContainText("Done.", { timeout: 20_000 });
  const sent = await page.evaluate(() => (window as unknown as { sent: { gas: string; gasPrice: string; to: string }[] }).sent);
  expect(sent).toHaveLength(1); expect(BigInt(sent[0].gas)).toBe(59_206n); expect(BigInt(sent[0].gasPrice)).toBe(50_000_000_000n); expect(sent[0].to.toLowerCase()).toBe("0x3600000000000000000000000000000000000000");
  expect(calls.slice(0, 3)).toEqual(["invest", "funding", "run"]); expect(rpc).toEqual([]);
});

test("USYC pool deposit is one click: exact approval then deposit, each inside the server's gas ceiling, no Arc RPC from the browser", async ({ page }) => {
  await liveSession(page); await liveReads(page, "20000000");
  const pool = "0x4F1E3B1c0A9D8E7f6a5B4C3D2E1f0A9b8C7d6E5f", usdcToken = "0x3600000000000000000000000000000000000000";
  const hashes = ["0x" + "a".repeat(64), "0x" + "b".repeat(64)];
  await page.addInitScript(({ address, hashes }) => {
    const sent: unknown[] = []; (window as unknown as { sent: unknown[] }).sent = sent;
    Object.defineProperty(window, "ethereum", { value: { isMetaMask: true, request: async ({ method, params }: { method: string; params?: unknown[] }) => { if (method === "eth_chainId") return "0x4cef52"; if (method === "eth_accounts" || method === "eth_requestAccounts") return [address]; if (method === "eth_sendTransaction") { sent.push(params?.[0]); return hashes[sent.length - 1]; } throw new Error(`Unexpected wallet request: ${method}`); }, on: () => undefined, removeListener: () => undefined } });
  }, { address, hashes });
  let deposited = false; const posted: unknown[] = [];
  const position = () => ({ wallet: address, pool, circle: "OK", depositsPaused: false, maxDepositUsdc: "1000000000", shares: deposited ? "4385000000000" : "0", usycMinor: deposited ? "4385000" : "0", valueUsdc: deposited ? "4997600" : "0", maxWithdrawShares: deposited ? "4385000000000" : "0", maxWithdrawUsdc: deposited ? "4997600" : "0", priceUsdcPerUsyc: "1139744957475496722", subscribePriceUsdcPerUsyc: "1139744957475496722", afterHoursPricing: false, observedAt: new Date().toISOString() });
  const step = (stage: string, to: string, data: string, gasLimit: string) => ({ stage, call: { to, data, value: "0" }, gasBudgetWei: (BigInt(gasLimit) * 50_000_000_000n).toString(), gasCeiling: { gasLimit, gasPriceWei: "50000000000" } });
  await page.route("**/api/usyc", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { status: "READY", position: position(), executionEnabled: true, executionNote: null, walletCanSign: true } });
    const body = route.request().postDataJSON() as { action: string; step?: string }; posted.push(body);
    if (body.action === "QUOTE_DEPOSIT") return route.fulfill({ json: { status: "READY", quote: { kind: "DEPOSIT", wallet: address, amountMinor: "5000000", steps: [step("APPROVE", usdcToken, "0x095ea7b3", "46447"), step("DEPOSIT", pool, "0x6e553f65", "397200")], preview: { usdcMinor: "5000000", shares: "4385000000000", minimum: "4363075000000", afterHoursPricing: false }, networkFeeMinor: "22183", gasSimulated: true, observedAt: new Date().toISOString() } } });
    if (body.step === "DEPOSIT") deposited = true;
    return route.fulfill({ json: body.step === "APPROVE" ? { status: "CONFIRMED", step: "APPROVE", txHash: hashes[0] } : { status: "CONFIRMED", step: "DEPOSIT", txHash: hashes[1], depositedUsdcMinor: "5000000", receivedShares: "4385000000000" } });
  });
  await page.goto("/"); await page.getByRole("button", { name: /choose wallet/i }).click(); await page.getByRole("button", { name: "MetaMask", exact: true }).click();
  await expect(page.getByText("Custody: user")).toBeVisible();
  await page.getByRole("link", { name: "Strategies" }).first().click();
  const rpc: string[] = []; page.on("request", (request) => { if (/rpc\.testnet\.arc/.test(request.url())) rpc.push(request.url()); });
  await expect(page.getByText("Circle enabled")).toBeVisible();
  await page.getByLabel("USYC pool amount").fill("5"); await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await expect(page.getByRole("region", { name: "Deposit progress" })).toContainText("Deposit verified on Arc Testnet", { timeout: 20_000 });
  const sent = await page.evaluate(() => (window as unknown as { sent: { gas: string; gasPrice: string; to: string; data: string }[] }).sent);
  expect(sent.map((item) => [item.to.toLowerCase(), BigInt(item.gas), BigInt(item.gasPrice)])).toEqual([[usdcToken, 46_447n, 50_000_000_000n], [pool.toLowerCase(), 397_200n, 50_000_000_000n]]);
  expect(posted.map((item) => (item as { action: string; step?: string }).step ?? (item as { action: string }).action)).toEqual(["QUOTE_DEPOSIT", "APPROVE", "DEPOSIT"]);
  // The refreshed position shows the new balance.
  await expect(page.getByText("4.997600 USDC").first()).toBeVisible();
  expect(rpc).toEqual([]);
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
