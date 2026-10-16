// Captures the footage for the Hodd demo film (video/src/demo). Nothing here signs or sends a transaction.
//
// - Live pages through the network proxy: www.hoddfinance.xyz and the Arcscan pages of every transaction the film shows.
// - The console from this repository's production build (`pnpm build && pnpm exec next start -p 3107` at the repo root).
//   Its own server routes read live Arc Testnet data (wallet balance, Morpho vault APY, Gateway balances). Only what needs
//   the owner's signed-in Supabase session is supplied from records: the workspace (the owner's real wallet and policy
//   with sample bills, labelled as such in the film) and the Autopilot status (the production owner's real runs and steps
//   from demo/evidence/agent-history.json, with balances and vault settings read onchain by read-balances.mjs and
//   read-vault-config.mjs).
//
// Usage (repo root): node video/scripts/capture-demo.mjs [names...]
import { chromium } from "@playwright/test";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "public", "demo", "shots");
const EVIDENCE = join(HERE, "..", "demo", "evidence");
mkdirSync(OUT, { recursive: true });
const BASE = "http://127.0.0.1:3107";
const json = (name) => JSON.parse(readFileSync(join(EVIDENCE, name), "utf8"));
const history = json("agent-history.json"), balances = json("balances.json"), vaultConfig = json("vault-config.json"), receipts = json("receipts.json");

const DAY = 86_400_000, now = Date.now();
const at = (days) => { const d = new Date(now + days * DAY); d.setUTCHours(17, 0, 0, 0); return d.toISOString(); };
const usdc = (amount) => ({ currency: "USDC", minorUnits: String(Math.round(amount * 1e6)), decimals: 6 });
const OWNER = "0xDEf09d06764EE3cA611Ce186f47dBd3f546d2e7C";

// The owner's real wallet and policy (production treasury_workspaces row). The bills are samples for the film.
const workspace = {
  schemaVersion: 4, treasuryMode: "ARC_TESTNET_WALLET", updatedAt: new Date(now - 60_000).toISOString(),
  walletConnection: { provider: "INJECTED_METAMASK", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address: OWNER, label: "Owner wallet", connectedAt: "2026-10-09T12:00:00.000Z" },
  totalTreasury: usdc(0), liquidUsdc: usdc(0), pendingTransactions: usdc(0), paymentReservations: [],
  policy: { safetyBuffer: usdc(1), minimumLiquidityCoverageBps: 500, planningHorizonDays: 30, protectionLeadDays: 3,
    strategyCapsBps: { LIQUID: 10000, MORPHO: 5000, USYC: 5000, BTC_RESERVE: 0 }, enabledStrategies: { LIQUID: true, MORPHO: true, USYC: false, BTC_RESERVE: false },
    liquidityWaterfall: ["LIQUID_USDC", "MORPHO", "USYC", "BTC_CREDIT", "BTC_SALE"] },
  targetAllocationsBps: { LIQUID: 5000, MORPHO: 5000, USYC: 0, BTC_RESERVE: 0 },
  obligations: [
    { id: "sample-payroll", title: "Payroll", category: "PAYROLL", amount: usdc(12), dueAt: at(2), recipient: "Sample bill", priority: "CRITICAL", status: "UPCOMING", description: "Sample bill for the demo.", recipientAddress: null, revision: 1 },
    { id: "sample-rent", title: "Studio rent", category: "RENT", amount: usdc(6), dueAt: at(8), recipient: "Sample bill", priority: "HIGH", status: "UPCOMING", description: "Sample bill for the demo.", recipientAddress: null, revision: 1 },
    { id: "sample-invoice", title: "Supplier invoice", category: "VENDOR", amount: usdc(4.5), dueAt: at(15), recipient: "Sample bill", priority: "NORMAL", status: "UPCOMING", description: "Sample bill for the demo.", recipientAddress: null, revision: 1 },
    { id: "sample-hosting", title: "Cloud hosting", category: "SUBSCRIPTION", amount: usdc(1.5), dueAt: at(22), recipient: "Sample bill", priority: "LOW", status: "UPCOMING", description: "Sample bill for the demo.", recipientAddress: null, revision: 1 },
  ],
  strategies: [
    { id: "liquid-usdc", name: "Liquid USDC", kind: "LIQUID", balance: usdc(0), redeemable: usdc(0), apyBps: null, risk: "LOW", liquidity: "INSTANT", integration: "LIVE" },
    { id: "morpho-usdc", name: "Morpho USDC Vault", kind: "MORPHO", balance: usdc(0), redeemable: usdc(0), apyBps: null, risk: "MODERATE", liquidity: "VARIABLE", integration: "LIVE" },
    { id: "usyc-reserve", name: "USYC Reserve", kind: "USYC", balance: usdc(0), redeemable: usdc(0), apyBps: null, risk: "LOW", liquidity: "RESTRICTED", integration: "LIVE" },
    { id: "btc-reserve", name: "BTC Reserve · Not available on Arc Testnet", kind: "BTC_RESERVE", balance: usdc(0), redeemable: usdc(0), apyBps: null, risk: "HIGH", liquidity: "VARIABLE", integration: "UNAVAILABLE" },
  ],
  activities: [], decisions: [],
  integrations: [
    { name: "User wallet", status: "DEMO", message: "MetaMask · user-controlled." },
    { name: "Arc Testnet", status: "DEMO", message: "Arc Testnet · chain 5042002 · USDC as gas." },
  ],
};

// The Autopilot status the console would receive for the production owner, from records and onchain reads.
const autopilotStatus = {
  status: "READY", mode: "TESTNET_LIVE", executionEnabled: true, policyMorphoCapBps: 5000,
  advisor: { available: true, model: "openai/gpt-oss-120b" },
  wallet: { address: "0xae407aa884d859e10475e609ad03a7cb6c11750b", owner_address: OWNER.toLowerCase(), account_type: "EOA", vault_address: "0xa425dd0acc673405e648ebe64eed2fc4da0ad02d" },
  vault: { address: "0xA425dD0ACC673405E648EBe64eED2fC4Da0AD02d", deployed: true, factory: "0x311578B21F269ca0E45f5c16324A3E51f69ce389", paused: vaultConfig.paused === "true", limitsLifted: true,
    limits: { maxDepositPerTxMinor: vaultConfig.maxDepositPerTx, depositLimit24hMinor: vaultConfig.depositLimit24h, maxPaymentPerTxMinor: vaultConfig.maxPaymentPerTx, paymentLimit24hMinor: vaultConfig.paymentLimit24h },
    strategies: ["0xAabbeF1D3971c710276ed41eC791BbE14CdB8E88", "0x97A7BAaA5416e0aC0674C395cec22FF606120b76"], depositRoomMinor: vaultConfig.maxDepositPerTx, paymentRoomMinor: vaultConfig.maxPaymentPerTx, agentGasMinor: balances.agentWalletMinor },
  bills: [], needsYou: [],
  mandate: { budgetMinor: "75000001", maxMorphoBps: 5000, reserveMinor: "0", maxPerRunMinor: "75000001", enabled: true, paused: false }, spentMinor: "35031234", returnRequested: false,
  balances: { cashMinor: balances.vaultCashMinor, positionMinor: balances.vaultMorpho.assetsMinor, redeemableMinor: balances.vaultMorpho.assetsMinor, usycMinor: balances.vaultUsyc.assetsMinor, usycRedeemableMinor: balances.vaultUsyc.assetsMinor, usycAvailable: true, morphoApyBps: 420, usycApyBps: null, observedAt: balances.observedAt },
  balanceError: null, runs: history.runs, steps: history.steps,
};

async function session(page) {
  const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "owner@hodd.example", created_at: "2026-10-01T00:00:00.000Z", app_metadata: {}, user_metadata: {} };
  let current = structuredClone(workspace), revision = 9, authOrigin = "";
  await page.route(BASE + "/**", async (route) => { const headers = { ...route.request().headers() }; delete headers.cookie; await route.continue({ headers }); });
  await page.route("**/auth/v1/**", async (route) => { authOrigin = new URL(route.request().url()).origin; await route.fulfill({ json: new URL(route.request().url()).pathname.endsWith("/user") ? user : {} }); });
  await page.route("**/rest/v1/**", async (route) => {
    const table = new URL(route.request().url()).pathname.split("/").at(-1);
    if (table === "treasury_workspaces") {
      if (route.request().method() === "POST") { current = route.request().postDataJSON().workspace; revision++; await route.fulfill({ json: { revision } }); return; }
      await route.fulfill({ json: { workspace: current, revision } }); return;
    }
    if (table === "wallet_ownership_proofs") { await route.fulfill({ json: { wallet_address: OWNER.toLowerCase() } }); return; }
    await route.fulfill({ json: [] });
  });
  await page.addInitScript(({ address }) => {
    const provider = { isMetaMask: true, request: async ({ method }) => {
      if (method === "eth_chainId") return "0x4cef52";
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
      if (method === "wallet_switchEthereumChain") return null;
      throw new Error("This capture never signs: " + method);
    }, on: () => undefined, removeListener: () => undefined };
    Object.defineProperty(window, "ethereum", { value: provider });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "io.metamask", name: "MetaMask", icon: "data:,", rdns: "io.metamask" }, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { address: OWNER });
  await page.route("**/api/autopilot/active", (route) => route.fulfill({ json: { active: true } }));
  await page.route("**/api/autopilot/status", (route) => route.fulfill({ json: autopilotStatus }));
  await page.route("**/api/hoddie/consent*", (route) => route.fulfill({ json: { status: "READY", allowed: true } }));
  await page.goto(BASE + "/login"); await page.getByRole("textbox", { name: "Email" }).fill(user.email);
  await page.getByRole("button", { name: /continue with email/i }).click();
  await page.waitForTimeout(1500);
  const project = new URL(authOrigin).hostname.split(".")[0];
  const payload = { sub: user.id, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iss: `${authOrigin}/auth/v1` };
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.capture`;
  const s = { access_token: token, refresh_token: "capture", token_type: "bearer", expires_in: 3600, expires_at: payload.exp, user };
  await page.context().addCookies([{ name: `sb-${project}-auth-token`, value: `base64-${Buffer.from(JSON.stringify(s)).toString("base64url")}`, url: BASE }]);
}

const settle = async (page, ms = 1500) => { await page.waitForLoadState("networkidle").catch(() => undefined); await page.waitForTimeout(ms); };
const shot = async (target, name, options = {}) => { await target.screenshot({ path: join(OUT, name + ".png"), ...options }); console.log("captured", name); };
const tidy = (page) => page.addStyleTag({ content: 'div[role="note"]:has(> button){display:none!important} *{caret-color:transparent!important}' }).catch(() => undefined);
const want = (name) => process.argv.length <= 2 || process.argv.slice(2).includes(name);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium", proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY, bypass: "127.0.0.1,localhost" } : undefined });
const newPage = async (width = 1600, height = 900) => (await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2 })).newPage();

if (want("live")) {
  const page = await newPage();
  await page.goto("https://www.hoddfinance.xyz/", { waitUntil: "networkidle", timeout: 90_000 }); await page.waitForTimeout(4000);
  await shot(page, "live-landing");
  await shot(page, "live-landing-full", { fullPage: true });
  await page.goto("https://app.hoddfinance.xyz/login", { waitUntil: "networkidle", timeout: 90_000 }); await page.waitForTimeout(2500);
  await shot(page, "live-app-login");
  await page.context().close();
}

if (want("arcscan")) {
  const page = await newPage(1600, 1000);
  for (const item of receipts.results) {
    await page.goto(item.explorer, { waitUntil: "networkidle", timeout: 90_000 }); await page.waitForTimeout(2500);
    await shot(page, "arcscan-" + item.id);
  }
  for (const [name, address] of [["vault", "0xA425dD0ACC673405E648EBe64eED2fC4Da0AD02d"], ["agent", "0xae407AA884d859e10475E609aD03a7Cb6C11750b"]]) {
    await page.goto(`https://testnet.arcscan.app/address/${address}`, { waitUntil: "networkidle", timeout: 90_000 }); await page.waitForTimeout(3000);
    await shot(page, "arcscan-address-" + name);
  }
  await page.goto(receipts.results.find((item) => item.id === "agent-invest").explorer + "?tab=logs", { waitUntil: "networkidle", timeout: 90_000 }); await page.waitForTimeout(3000);
  await shot(page, "arcscan-agent-invest-logs");
  await page.context().close();
}

if (want("console")) {
  const page = await newPage();
  await session(page);
  await page.goto(BASE + "/"); await settle(page, 2500); await tidy(page);
  await page.getByRole("button", { name: /reconnect metamask/i }).first().click().catch(() => undefined);
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await settle(page, 2500); await page.mouse.move(1599, 899);
  await shot(page, "console-overview"); await shot(page, "console-overview-full", { fullPage: true });
  const nav = async (label) => { await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: label, exact: true }).click(); await settle(page, 2000); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await settle(page, 1200); await page.mouse.move(1599, 899); };
  for (const [label, name] of [["Obligations", "obligations"], ["Policy", "policy"], ["Invest", "invest"], ["Activity", "activity"], ["Connections", "connections"]]) {
    await nav(label).catch((error) => console.log("nav", label, error.message));
    if (name === "connections") await page.evaluate(() => { const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; if (node.nodeValue?.includes("127.0.0.1:3107")) node.nodeValue = node.nodeValue.replace("http://127.0.0.1:3107", "https://app.hoddfinance.xyz"); } });
    await shot(page, "console-" + name); await shot(page, "console-" + name + "-full", { fullPage: true });
  }
  await nav("Autopilot");
  await shot(page, "console-autopilot"); await shot(page, "console-autopilot-full", { fullPage: true });
  await page.getByText("History", { exact: false }).last().click().catch(() => undefined); await page.waitForTimeout(800);
  for (const summary of await page.locator("summary", { hasText: /Steps/ }).all()) await summary.click().catch(() => undefined);
  await page.waitForTimeout(600);
  await shot(page, "console-autopilot-history-full", { fullPage: true });
  await nav("Hoddie");
  const input = page.getByRole("textbox").last();
  for (const [question, name] of [["Can I pay this week's bills?", "hoddie-bills"], ["How much can I safely invest?", "hoddie-invest"]]) {
    const clear = page.getByRole("button", { name: /clear chat/i }); if (await clear.isEnabled().catch(() => false)) { await clear.click(); await page.waitForTimeout(400); }
    await input.fill(question); await page.getByRole("button", { name: /send/i }).last().click(); await page.waitForTimeout(2200); await page.mouse.move(1599, 899);
    await shot(page, "console-" + name);
  }
  await page.context().close();
}
await browser.close();
