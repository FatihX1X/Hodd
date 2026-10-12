// Captures real Hodd console screens for the film.
// Runs the production build (`pnpm build && pnpm exec next start -p 3107` at the repo root) with the same
// browser-side session and data interception as tests/e2e/live-session.ts: no hosted state is read or changed.
// Usage (from the repo root): node video/scripts/capture-app.mjs
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const BASE = "http://127.0.0.1:3107";
const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "shots");
mkdirSync(OUT, { recursive: true });

const DAY = 86_400_000;
const now = Date.now();
const at = (days, hour = 17) => { const d = new Date(now + days * DAY); d.setUTCHours(hour, 0, 0, 0); return d.toISOString(); };
const ago = (minutes) => new Date(now - minutes * 60_000).toISOString();
const usdc = (amount) => ({ currency: "USDC", minorUnits: String(Math.round(amount * 1_000_000)), decimals: 6 });
const hash = (seed) => "0x" + Array.from({ length: 64 }, (_, i) => "0123456789abcdef"[(seed * 7 + i * 13 + ((i * seed) % 5)) % 16]).join("");

const owner = "0x7A3f9C21bE04D5a8E6c2F19b84D0aE5c3B7f41D2";
const agent = "0x4bC81e07A6f2D93c5E1a0F78b2D4c96E3a57B0f9";
const vault = "0xAAbbef1D3971c710276Ed41eC791bbE14cDB8E88";
const payee = "0x62dCe01b1a7B9a6f592f148d305E0D5751478386";

const LIQUID = 18_420.5, MORPHO = 12_000;

const workspace = {
  schemaVersion: 4, treasuryMode: "ARC_TESTNET_WALLET", updatedAt: ago(2),
  walletConnection: { provider: "INJECTED_RABBY", custody: "USER_CONTROLLED", accountType: "EOA", chain: "ARC-TESTNET", chainId: 5042002, address: owner, label: "Studio treasury", connectedAt: ago(60 * 24 * 6) },
  totalTreasury: usdc(LIQUID + MORPHO), liquidUsdc: usdc(LIQUID), pendingTransactions: usdc(0), paymentReservations: [],
  policy: { safetyBuffer: usdc(2500), minimumLiquidityCoverageBps: 10000, planningHorizonDays: 30, protectionLeadDays: 7,
    strategyCapsBps: { LIQUID: 10000, MORPHO: 6000, USYC: 0, BTC_RESERVE: 0 },
    enabledStrategies: { LIQUID: true, MORPHO: true, USYC: false, BTC_RESERVE: false },
    liquidityWaterfall: ["LIQUID_USDC", "MORPHO", "USYC", "BTC_CREDIT", "BTC_SALE"] },
  targetAllocationsBps: { LIQUID: 4000, MORPHO: 6000, USYC: 0, BTC_RESERVE: 0 },
  obligations: [
    { id: "payroll-oct", title: "October payroll", category: "PAYROLL", amount: usdc(6800), dueAt: at(3), recipient: "Payroll batch · 6 people", priority: "CRITICAL", status: "UPCOMING", description: "Monthly payroll for the studio team.", recipientAddress: payee, revision: 2 },
    { id: "rent-oct", title: "Studio rent", category: "RENT", amount: usdc(2400), dueAt: at(6), recipient: "Harbor Lofts LLC", priority: "HIGH", status: "UPCOMING", description: "Office lease, Unit 4B.", recipientAddress: "0x9F1a2B3c4D5e6F708192A3b4C5d6E7f809A1b2C3", revision: 1 },
    { id: "aws-oct", title: "AWS infrastructure", category: "SUBSCRIPTION", amount: usdc(640), dueAt: at(12), recipient: "Cloud vendor", priority: "NORMAL", status: "UPCOMING", description: "Monthly cloud bill.", recipientAddress: "0x3d4E5f60718293A4b5C6d7E8f9012a3B4c5D6e7F", revision: 1 },
    { id: "invoice-218", title: "Contractor invoice #218", category: "VENDOR", amount: usdc(3250), dueAt: at(19), recipient: "Lumen Motion Co.", priority: "NORMAL", status: "UPCOMING", description: "Motion design retainer.", recipientAddress: "0xB2c3D4e5F60718293a4B5c6D7e8F9012A3b4C5d6", revision: 1 },
    { id: "saas-nov", title: "Design tools", category: "SUBSCRIPTION", amount: usdc(180), dueAt: at(24), recipient: "Figma · Linear", priority: "LOW", status: "UPCOMING", description: "Team seats.", recipientAddress: null, revision: 1 },
    { id: "tax-q4", title: "Q4 estimated tax", category: "TAX", amount: usdc(4100), dueAt: at(41), recipient: "Tax authority", priority: "HIGH", status: "UPCOMING", description: "Quarterly estimate.", recipientAddress: null, revision: 1 },
    { id: "brand-draft", title: "Brand refresh", category: "OTHER", amount: usdc(1500), dueAt: at(33), recipient: "Draft · not protected", priority: "LOW", status: "DRAFT", description: "Draft until the quote is final.", recipientAddress: null, revision: 1 },
    { id: "payroll-sep", title: "September payroll", category: "PAYROLL", amount: usdc(6800), dueAt: at(-27), recipient: "Payroll batch · 6 people", priority: "CRITICAL", status: "PAID", description: "Paid with a verified Arc receipt.", recipientAddress: payee, revision: 3 },
  ],
  strategies: [
    { id: "liquid-usdc", name: "Liquid USDC", kind: "LIQUID", balance: usdc(LIQUID), redeemable: usdc(LIQUID), apyBps: null, risk: "LOW", liquidity: "INSTANT", integration: "LIVE" },
    { id: "morpho-usdc", name: "Morpho USDC Vault", kind: "MORPHO", balance: usdc(MORPHO), redeemable: usdc(MORPHO), apyBps: 487, risk: "MODERATE", liquidity: "VARIABLE", integration: "LIVE" },
    { id: "usyc-reserve", name: "USYC Reserve · Not available on Arc Testnet", kind: "USYC", balance: usdc(0), redeemable: usdc(0), apyBps: null, risk: "LOW", liquidity: "RESTRICTED", integration: "UNAVAILABLE" },
    { id: "btc-reserve", name: "BTC Reserve · Not available on Arc Testnet", kind: "BTC_RESERVE", balance: usdc(0), redeemable: usdc(0), apyBps: null, risk: "HIGH", liquidity: "VARIABLE", integration: "UNAVAILABLE" },
  ],
  activities: [
    { id: "a1", occurredAt: ago(2), actor: "SYSTEM", action: "Treasury Engine evaluated", summary: "Deployable capital recalculated to 17,630.50 USDC.", reason: "A workspace input changed, so protected capital, coverage and feasibility outputs were recomputed.", policy: { status: "PASS", label: "Treasury policy", reason: "All configured liquidity rules pass." }, approval: "NOT_REQUIRED", execution: "LOCAL_ONLY" },
    { id: "a2", occurredAt: ago(38), actor: "AGENT", action: "Autopilot invested idle budget", summary: "Deposited 400.00 USDC into Morpho from the agent wallet.", reason: "Bills are covered and the agent's cash reserve is full.", policy: { status: "PASS", label: "Onchain receipt", reason: "Verified Arc receipt for the allowlisted vault." }, approval: "APPROVED", execution: "COMPLETE", transactionHash: hash(3), explorerUrl: "https://testnet.arcscan.app/tx/" + hash(3) },
    { id: "a3", occurredAt: ago(95), actor: "HUMAN", action: "Morpho deposit confirmed", summary: "Deposited 2,000.00 USDC into Morpho USDC Vault.", reason: "Idle capital above protected obligations and the safety buffer.", policy: { status: "PASS", label: "Onchain receipt", reason: "The record was created from the confirmed App Kit response." }, approval: "APPROVED", execution: "COMPLETE", transactionHash: hash(5), explorerUrl: "https://testnet.arcscan.app/tx/" + hash(5) },
    { id: "a4", occurredAt: ago(180), actor: "AGENT", action: "Hoddie draft approved", summary: "Contractor invoice #218 added for 3,250.00 USDC.", reason: "Prepared by Hoddie, confirmed by the owner in two steps.", policy: { status: "PASS", label: "Owner approval", reason: "The owner approved the exact change." }, approval: "APPROVED", execution: "LOCAL_ONLY" },
    { id: "a5", occurredAt: ago(60 * 26), actor: "HUMAN", action: "Bill paid", summary: "September payroll paid · 6,800.00 USDC.", reason: "Signed in the owner's wallet; PAID only after the server verified the USDC transfer.", policy: { status: "PASS", label: "Onchain receipt", reason: "Canonical USDC Transfer verified on Arc." }, approval: "APPROVED", execution: "COMPLETE", transactionHash: hash(9), explorerUrl: "https://testnet.arcscan.app/tx/" + hash(9) },
    { id: "a6", occurredAt: ago(60 * 30), actor: "HUMAN", action: "Policy updated", summary: "Safety buffer set to 2,500.00 USDC. Protection lead time 7 days.", reason: "User-authored workspace policy.", policy: { status: "PASS", label: "Local policy", reason: "The value was validated before it was stored." }, approval: "NOT_REQUIRED", execution: "LOCAL_ONLY" },
    { id: "a7", occurredAt: ago(60 * 52), actor: "SYSTEM", action: "User-controlled wallet connected", summary: "Studio treasury is now the single authoritative Arc Testnet treasury wallet.", reason: "Hodd stores only public wallet metadata. Signing remains on the selected user-controlled wallet surface.", policy: { status: "PASS", label: "Wallet ownership", reason: "Free signed message verified." }, approval: "NOT_REQUIRED", execution: "LOCAL_ONLY" },
  ],
  decisions: [{ id: "d1", createdAt: ago(2), title: "Keep payroll liquid", summary: "October payroll is inside the protection lead time and stays in liquid USDC.", rationale: "Bills before yield.", policy: { status: "PASS", label: "Liquidity check", reason: "Protected capital is calculated by the Treasury Engine." } }],
  integrations: [
    { name: "User wallet", status: "DEMO", message: "Rabby · user-controlled. Your wallet signs every transaction." },
    { name: "Arc Testnet", status: "DEMO", message: "Arc Testnet · chain 5042002 · USDC as gas." },
    { name: "Morpho", status: "DEMO", message: "Allowlisted Morpho vault via Circle App Kit." },
    { name: "USYC / BTC", status: "UNAVAILABLE", message: "Not available on Arc Testnet. Allocation targets and caps are zero." },
  ],
};

const chainRow = (key, label, domain, symbol, wait, wallet, gateway) => ({ key, label, domain, nativeSymbol: symbol, depositWait: wait, wallet: usdc(wallet), gateway: usdc(gateway) });
const chains = [
  chainRow("Arc_Testnet", "Arc Testnet", 26, "USDC", "under a minute", LIQUID, 0),
  chainRow("Base_Sepolia", "Base Sepolia", 6, "ETH", "about 20 minutes", 1250, 3400),
  chainRow("Ethereum_Sepolia", "Ethereum Sepolia", 0, "ETH", "about 20 minutes", 820, 1500),
  chainRow("Arbitrum_Sepolia", "Arbitrum Sepolia", 3, "ETH", "about 20 minutes", 0, 960),
  chainRow("Optimism_Sepolia", "OP Sepolia", 2, "ETH", "about 20 minutes", 410, 0),
  chainRow("Avalanche_Fuji", "Avalanche Fuji", 1, "AVAX", "a few seconds", 0, 640),
  chainRow("Polygon_Amoy_Testnet", "Polygon Amoy", 7, "POL", "a few minutes", 300, 0),
  chainRow("Unichain_Sepolia", "Unichain Sepolia", 10, "ETH", "about 20 minutes", 0, 0),
  chainRow("World_Chain_Sepolia", "World Chain Sepolia", 14, "ETH", "about 20 minutes", 0, 0),
  chainRow("Sonic_Testnet", "Sonic Testnet", 13, "S", "a few seconds", 0, 0),
  chainRow("Sei_Testnet", "Sei Testnet", 16, "SEI", "a few seconds", 0, 0),
  chainRow("HyperEVM_Testnet", "HyperEVM Testnet", 19, "HYPE", "a few seconds", 0, 0),
];
const sum = (field) => chains.reduce((total, row) => total + Number(row[field].minorUnits), 0);
const gatewayView = { address: owner, observedAt: ago(0), gatewayStatus: "READY", unavailableChains: [], chains,
  totals: { wallet: { currency: "USDC", decimals: 6, minorUnits: String(sum("wallet")) }, gateway: { currency: "USDC", decimals: 6, minorUnits: String(sum("gateway")) }, all: { currency: "USDC", decimals: 6, minorUnits: String(sum("wallet") + sum("gateway")) }, offArcWallet: { currency: "USDC", decimals: 6, minorUnits: String(sum("wallet") - Number(chains[0].wallet.minorUnits)) } } };

const earnVault = { address: vault, name: "EarnKit USDC Vault (Arc Testnet)", chain: "ARC-TESTNET", protocol: "MORPHO", asset: "USDC", assetAddress: "0x3600000000000000000000000000000000000000", apyBps: 487, totalDeposits: usdc(1_284_350), liquidity: usdc(642_900), status: "ACTIVE", circleGuarded: true, warnings: [], earnKitWarnings: [], verifiedAt: "2026-09-28T16:14:39.000Z", verifiedBlock: "64465893" };
const earnPosition = { walletAddress: owner, vaultAddress: vault, vaultName: earnVault.name, currentBalance: usdc(MORPHO), maxWithdrawable: usdc(MORPHO), redeemable: usdc(MORPHO), liquidityStatus: "READY", shares: "11873.402215", apyBps: 487, pnl: { status: "AVAILABLE", principalDeposited: usdc(11_820), totalYieldEarned: { currency: "USDC", minorUnits: "180000000", decimals: 6 } }, observedAt: ago(0) };

const decision = (kind, deposit, withdraw, transfer, remaining, explanation) => ({ kind, depositMinor: String(deposit * 1e6), withdrawMinor: String(withdraw * 1e6), transferMinor: String(transfer * 1e6), remainingBudgetMinor: String(remaining * 1e6), protectedMinor: "0", explanation });
const runs = [
  { id: "11111111-1111-4111-8111-111111111111", state: "COMPLETED", decision: decision("INVEST", 400, 0, 0, 600, "Bills are covered and the reserve is full. Invest 400 USDC of idle budget in Morpho."), failure: null, created_at: ago(38) },
  { id: "22222222-2222-4222-8222-222222222222", state: "COMPLETED", decision: decision("RESERVE_REFILL", 0, 120, 0, 600, "The agent's cash reserve fell below 150 USDC. Withdraw 120 USDC from Morpho to refill it."), failure: null, created_at: ago(60 * 25) },
  { id: "33333333-3333-4333-8333-333333333333", state: "NO_ACTION", decision: decision("NO_ACTION", 0, 0, 0, 600, "Balances are fresh, bills are funded and the reserve is full. Nothing to do."), failure: null, created_at: ago(60 * 49) },
  { id: "44444444-4444-4444-8444-444444444444", state: "COMPLETED", decision: decision("LIQUIDITY_TOP_UP", 0, 250, 250, 600, "Payroll is due in 3 days and your wallet is short. Send 250 USDC back to the owner."), failure: null, created_at: ago(60 * 73) },
];
const steps = [
  { id: "s1", run_id: runs[0].id, stage: "EARN", state: "COMPLETED", tx_hash: hash(3), circle_transaction_id: null },
  { id: "s2", run_id: runs[1].id, stage: "EARN", state: "COMPLETED", tx_hash: hash(4), circle_transaction_id: null },
  { id: "s3", run_id: runs[3].id, stage: "TRANSFER", state: "COMPLETED", tx_hash: hash(6), circle_transaction_id: null },
];
const autopilotStatus = { status: "READY", mode: "ACTIVE", executionEnabled: true, policyMorphoCapBps: 6000,
  wallet: { address: agent, owner_address: owner, account_type: "EOA" },
  mandate: { budgetMinor: "1000000000", maxMorphoBps: 6000, reserveMinor: "150000000", maxPerRunMinor: "400000000", enabled: true, paused: false },
  spentMinor: "400000000", returnRequested: false,
  balances: { cashMinor: "220000000", positionMinor: "780000000", redeemableMinor: "780000000", observedAt: ago(1) }, balanceError: null, runs, steps };

async function session(page) {
  const user = { id: "00000000-0000-4000-8000-000000000001", aud: "authenticated", role: "authenticated", email: "owner@studio.example", created_at: ago(60 * 24 * 10), app_metadata: {}, user_metadata: {} };
  let current = structuredClone(workspace); let revision = 4; let authOrigin = "";
  await page.route(BASE + "/**", async (route) => { const headers = { ...route.request().headers() }; delete headers.cookie; await route.continue({ headers }); });
  await page.route("**/auth/v1/**", async (route) => { authOrigin = new URL(route.request().url()).origin; const path = new URL(route.request().url()).pathname; await route.fulfill({ contentType: "application/json", body: JSON.stringify(path.endsWith("/user") ? user : {}) }); });
  await page.route("**/rest/v1/**", async (route) => {
    const table = new URL(route.request().url()).pathname.split("/").at(-1);
    if (table === "treasury_workspaces") {
      if (route.request().method() === "POST") { current = route.request().postDataJSON().workspace; revision++; await route.fulfill({ contentType: "application/json", body: JSON.stringify({ revision }) }); return; }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify({ workspace: current, revision }) }); return;
    }
    if (table === "wallet_ownership_proofs") { await route.fulfill({ contentType: "application/json", body: JSON.stringify({ wallet_address: owner.toLowerCase() }) }); return; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify([]) });
  });
  // A Rabby-like injected wallet on Arc Testnet, so the console shows an active signer.
  await page.addInitScript(({ address }) => {
    const provider = { isRabby: true, isMetaMask: true, request: async ({ method }) => {
      if (method === "eth_chainId") return "0x4cef52";
      if (method === "eth_accounts" || method === "eth_requestAccounts") return [address];
      if (method === "wallet_switchEthereumChain") return null;
      if (method === "personal_sign") return "0x" + "1".repeat(130);
      if (method === "eth_blockNumber") return "0x3f5a2b1";
      throw new Error("Unexpected wallet request: " + method);
    }, on: () => undefined, removeListener: () => undefined };
    Object.defineProperty(window, "ethereum", { value: provider });
    const announce = () => window.dispatchEvent(new CustomEvent("eip6963:announceProvider", { detail: Object.freeze({ info: { uuid: "io.rabby", name: "Rabby Wallet", icon: "data:,", rdns: "io.rabby" }, provider }) }));
    window.addEventListener("eip6963:requestProvider", announce); announce();
  }, { address: owner });
  await page.route("**/api/arc/treasury?address=*", (route) => route.fulfill({ json: { status: "READY", snapshot: { address: owner, chain: "ARC-TESTNET", chainId: 5042002, balance: usdc(LIQUID), blockNumber: "66421905", observedAt: ago(0) } } }));
  await page.route("**/api/earn/portfolio*", (route) => route.fulfill({ json: { status: "READY", integration: { discovery: "READY", positionAccess: "READY", execution: "TESTNET_LIVE", configuredWalletAddress: owner, message: "Live Arc Testnet vault discovery" }, vaults: [earnVault], positions: [earnPosition], observedAt: ago(0) } }));
  await page.route("**/api/gateway/balances?address=*", (route) => route.fulfill({ json: { status: "READY", view: gatewayView } }));
  await page.route("**/api/autopilot/active", (route) => route.fulfill({ json: { active: true } }));
  await page.route("**/api/autopilot/status", (route) => route.fulfill({ json: autopilotStatus }));
  await page.route("**/api/hoddie/consent*", (route) => route.fulfill({ json: { status: "READY", allowed: true } }));
  await page.route("**/api/wallet/ownership*", (route) => route.fulfill({ json: { status: "READY", verified: true, address: owner } }));
  await page.goto(BASE + "/login"); await page.getByRole("textbox", { name: "Email" }).fill(user.email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByText("Check your email to continue.").waitFor();
  const project = new URL(authOrigin).hostname.split(".")[0];
  const payload = { sub: user.id, aud: "authenticated", role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, iss: `${authOrigin}/auth/v1` };
  const token = `${Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url")}.${Buffer.from(JSON.stringify(payload)).toString("base64url")}.test-signature`;
  const s = { access_token: token, refresh_token: "film-refresh", token_type: "bearer", expires_in: 3600, expires_at: payload.exp, user };
  await page.context().addCookies([{ name: `sb-${project}-auth-token`, value: `base64-${Buffer.from(JSON.stringify(s)).toString("base64url")}`, url: BASE }]);
  return { workspace: () => current, mutate: (change) => { current = change(current); revision++; } };
}

// Developer-only affordances (the smoke-workspace switch) stay out of the film.
const tidy = async (page) => { await page.addStyleTag({ content: 'div[role="note"]:has(> button){display:none!important} *{caret-color:transparent!important}' }).catch(() => undefined); };
const settle = async (page, ms = 1200) => { await page.waitForLoadState("networkidle").catch(() => undefined); await page.waitForTimeout(ms); };
const shot = async (target, name, options = {}) => { await target.screenshot({ path: join(OUT, name + ".png"), animations: "allow", ...options }); console.log("captured", name); };
const section = (page, heading) => page.locator("section").filter({ has: page.getByRole("heading", { name: heading, exact: true }) }).last();
const nav = async (page, label) => { await page.getByRole("navigation", { name: "Primary navigation" }).getByRole("link", { name: label, exact: true }).click(); await settle(page, 1400); await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await settle(page, 900); await page.mouse.move(1599, 999); };
/** Lets a test hold a mocked response until the film script is ready for the next frame. */
function gate() { let release = () => undefined; let promise = Promise.resolve(); return { arm() { promise = new Promise((resolve) => { release = resolve; }); }, open: () => release(), wait: () => promise }; }

const only = process.argv.slice(2);
const want = (name) => only.length === 0 || only.includes(name);

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium" });
const newPage = async () => (await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2, reducedMotion: "no-preference" })).newPage();

if (want("login")) { const p = await newPage(); await p.goto(BASE + "/login"); await settle(p); await shot(p, "login"); await p.context().close(); }

if (want("wallets")) {
  const p = await newPage(); const saved = workspace.walletConnection; workspace.walletConnection = null; workspace.treasuryMode = "LOCAL_DEMO";
  await session(p); workspace.walletConnection = saved; workspace.treasuryMode = "ARC_TESTNET_WALLET";
  await p.goto(BASE + "/"); await settle(p, 1500); await tidy(p);
  await p.getByRole("button", { name: /choose wallet/i }).first().click(); await p.waitForTimeout(700);
  await shot(p, "wallet-chooser"); await shot(p.getByRole("dialog"), "el-wallet-chooser");
  await p.context().close();
}

const page = await newPage();
const live = await session(page);
// Registered after the session so these handlers win over its pass-through route.
// Earn, payment and Autopilot flows answer one step at a time, released by this script.
const earnGate = gate(); let earnStep = 0;
const exec = "55555555-5555-4555-8555-555555555555";
const earnEvents = [[], [{ stage: "APPROVAL_SIGNATURE_REQUESTED" }], [{ stage: "APPROVAL_SIGNATURE_REQUESTED" }, { stage: "TRANSACTION_SUBMITTED", hash: hash(11) }], [{ stage: "APPROVAL_SIGNATURE_REQUESTED" }, { stage: "TRANSACTION_SUBMITTED", hash: hash(11) }, { stage: "APPROVAL_CONFIRMED", hash: hash(11) }, { stage: "EARN_SIGNATURE_REQUESTED" }], [{ stage: "APPROVAL_SIGNATURE_REQUESTED" }, { stage: "TRANSACTION_SUBMITTED", hash: hash(11) }, { stage: "APPROVAL_CONFIRMED", hash: hash(11) }, { stage: "EARN_SIGNATURE_REQUESTED" }, { stage: "TRANSACTION_SUBMITTED", hash: hash(12) }]];
const earnJob = (step) => step < earnEvents.length ? { status: "PENDING", executionId: exec, state: step === 0 ? "PREPARING" : "SUBMITTED", events: earnEvents[step], pending: null, result: null }
  : { status: "PENDING", executionId: exec, state: "COMPLETE", events: [...earnEvents.at(-1), { stage: "RECEIPT_VERIFIED", hash: hash(12) }], pending: null, result: { executionId: exec, operation: "DEPOSIT", status: "COMPLETE", txHash: hash(12), explorerUrl: "https://testnet.arcscan.app/tx/" + hash(12), vaultAddress: vault, amount: usdc(2500), residualPosition: null } };
await page.route("**/api/earn/quote", (route) => route.fulfill({ json: { status: "READY", quote: { quoteId: "66666666-6666-4666-8666-666666666666", operation: "DEPOSIT", walletAddress: owner, vaultAddress: vault, vaultName: earnVault.name, amount: usdc(2500), expectedShares: "2473.613204", sharesToRedeem: null, maxWithdrawable: null, fees: usdc(0.0184), gasFees: [], warnings: [], policy: { status: "PASS", label: "Earn policy", reason: "Deposit fits deployable capital, the Morpho cap and the safety buffer." }, expiresAt: new Date(Date.now() + 300_000).toISOString(), requiresWarningAcknowledgement: false } } }));
await page.route("**/api/earn/execute", (route) => route.fulfill({ json: earnJob(0) }));
await page.route("**/api/earn/execution", async (route) => { await earnGate.wait(); earnStep++; await route.fulfill({ json: earnJob(earnStep) }); });

const proposalId = "77777777-7777-4777-8777-777777777777";
const payRecord = (state) => ({ id: proposalId, state, txHash: state === "CONFIRMED" ? hash(21) : null, userOperationHash: null, receipt: state === "CONFIRMED" ? { blockNumber: "66422011", logIndex: 3, networkFee: usdc(0.0042) } : null,
  proposal: { id: proposalId, obligationId: "payroll-oct", obligationRevision: 2, scope: "TREASURY", wallet: live.workspace().walletConnection, recipientAddress: payee, recipientLabel: "Payroll batch · 6 people", amount: usdc(6800), feeReserve: usdc(0.012), balanceAfter: usdc(LIQUID - 6800.012), gasBudgetWei: "12000000000000000", feeQuote: null,
    policy: { status: "PASS", label: "Payment policy", reason: "Earlier bills, the safety buffer and post-payment coverage stay protected." }, expiresAt: new Date(Date.now() + 300_000).toISOString(), startBlock: "66421990", executionEnabled: true, executionReason: "Arc Testnet live execution is open for this wallet.", rail: "ARC_WALLET" } });
await page.route("**/api/payments", async (route) => {
  const body = route.request().postDataJSON() ?? {};
  await route.fulfill({ json: { status: "READY", record: payRecord(body.action === "REVIEW" ? "REVIEW_REQUIRED" : "CONFIRMED"), pending: null } });
});

const apGate = gate(); let apStep = -1;
const investRun = { id: "88888888-8888-4888-8888-888888888888", decision: decision("INVEST", 150, 0, 0, 450, "Bills are covered and the reserve is full. Invest 150 USDC of the new funding in Morpho."), failure: null, created_at: ago(0) };
const apSteps = [[], [{ id: "x1", run_id: investRun.id, stage: "APPROVAL", state: "SUBMITTED", tx_hash: hash(31), circle_transaction_id: null }],
  [{ id: "x2", run_id: investRun.id, stage: "EARN", state: "SUBMITTED", tx_hash: hash(32), circle_transaction_id: null }, { id: "x1", run_id: investRun.id, stage: "APPROVAL", state: "VERIFIED", tx_hash: hash(31), circle_transaction_id: null }],
  [{ id: "x2", run_id: investRun.id, stage: "EARN", state: "VERIFIED", tx_hash: hash(32), circle_transaction_id: null }, { id: "x1", run_id: investRun.id, stage: "APPROVAL", state: "VERIFIED", tx_hash: hash(31), circle_transaction_id: null }]];
const apStatus = () => apStep < 0 ? autopilotStatus : { ...autopilotStatus, runs: [{ ...investRun, state: apStep >= 3 ? "COMPLETED" : "RUNNING" }, ...runs], steps: [...apSteps[Math.min(apStep, 3)], ...steps],
  balances: apStep >= 3 ? { ...autopilotStatus.balances, cashMinor: "220000000", positionMinor: "930000000" } : autopilotStatus.balances };

await page.unroute("**/api/autopilot/status");
await page.route("**/api/autopilot/status", async (route) => {
  if (route.request().method() === "POST") { await apGate.wait(); apStep = Math.min(apStep + 1, 3); await route.fulfill({ json: { status: "READY", run: { ...investRun, state: apStep >= 3 ? "COMPLETED" : "RUNNING" } } }); return; }
  await route.fulfill({ json: apStatus() });
});

/** Opens the console and reconnects the in-memory signer, as a returning owner would. */
async function boot(page) {
  await page.goto(BASE + "/"); await settle(page, 1500); await tidy(page);
  await page.getByRole("button", { name: /reconnect rabby/i }).first().click().catch(() => undefined); await page.waitForTimeout(1200);
  await page.evaluate(() => window.dispatchEvent(new Event("focus"))); await settle(page, 1200);
  const collapse = page.getByRole("button", { name: "Collapse checklist" }); if (await collapse.isVisible().catch(() => false)) await collapse.click();
  await page.mouse.move(1599, 999); await settle(page, 800);
}
await boot(page);

if (want("overview")) {
  await shot(page, "overview"); await shot(page, "overview-full", { fullPage: true });
  await shot(page.locator("header.ink-grid").first(), "el-overview-header");
  await shot(section(page, "USDC on every chain"), "el-chains");
  await shot(page.getByRole("region", { name: "Total treasury", exact: true }), "el-total");
  await shot(page.getByRole("region", { name: "Next payment", exact: true }), "el-next");
  await shot(page.getByRole("region", { name: "Treasury overview", exact: true }), "el-kpis");
  await shot(section(page, "Runway"), "el-runway");
  await shot(section(page, "Where the treasury sits"), "el-sits");
  await shot(section(page, "Policy result"), "el-policy-result");
  await shot(section(page, "Recent activity"), "el-recent");
  await shot(section(page, "Integration boundaries"), "el-boundaries");
  const wallet = page.locator("section").filter({ hasText: "Verified USDC balance" }).last(); await shot(wallet, "el-wallet");
}
if (want("gateway")) {
  await page.getByRole("button", { name: /Show all 12 chains/i }).click().catch(() => undefined); await page.waitForTimeout(500);
  await shot(section(page, "USDC on every chain"), "el-chains-all");
  await section(page, "USDC on every chain").getByRole("button", { name: /Bring USDC to Arc/i }).click(); await page.waitForTimeout(900);
  const dialog = page.getByRole("dialog"); await shot(page, "gateway-move"); await shot(dialog, "el-gateway-move");
  await page.keyboard.press("Escape"); await page.waitForTimeout(500);
}
if (want("strategies") || want("earn")) {
  await nav(page, "Strategies");
  if (want("strategies")) {
    await shot(page, "strategies"); await shot(page, "strategies-full", { fullPage: true });
    await shot(section(page, "Strategies"), "el-strategies"); await shot(section(page, "Verified Morpho vaults"), "el-vaults"); await shot(section(page, "Capital boundary"), "el-boundary"); await shot(section(page, "Target allocation"), "el-targets");
  }
  if (want("earn")) {
    await section(page, "Verified Morpho vaults").getByRole("button", { name: "Deposit", exact: true }).click(); await page.waitForTimeout(800);
    const dialog = page.getByRole("dialog"); await dialog.getByLabel("Deposit amount").fill("2500"); await page.waitForTimeout(300);
    await shot(page, "earn-0"); await shot(dialog, "el-earn-0");
    earnGate.arm(); await dialog.getByRole("button", { name: "Deposit now" }).click(); await page.waitForTimeout(1600);
    for (let step = 1; step <= earnEvents.length; step++) {
      await shot(dialog, "el-earn-" + step); if (step === 1) await shot(page, "earn-1");
      const release = earnGate; release.open(); release.arm(); await page.waitForTimeout(3300);
    }
    earnGate.open(); await page.waitForTimeout(4500); await shot(dialog, "el-earn-done"); await shot(page, "earn-done");
    await page.keyboard.press("Escape"); await page.waitForTimeout(600);
  }
}
if (want("obligations") || want("payment") || want("new-bill") || want("pay-other")) {
  await nav(page, "Obligations");
  if (want("obligations")) {
    await shot(page, "obligations"); await shot(page, "obligations-full", { fullPage: true });
    await shot(section(page, "Outflows by week"), "el-outflows"); await shot(section(page, "Payment calendar"), "el-calendar"); await shot(section(page, "User-approved payments"), "el-payments");
  }
  if (want("new-bill")) {
    await page.getByRole("button", { name: "New obligation", exact: true }).click(); await page.waitForTimeout(700);
    await page.getByLabel("Obligation title").fill("Studio insurance"); await page.getByLabel("Obligation amount").fill("1200");
    const due = new Date(now + 9 * DAY).toISOString().slice(0, 10); await page.getByLabel("Due date").fill(due); await page.getByLabel("Obligation title").click(); await page.keyboard.press("End"); await page.waitForTimeout(400);
    await shot(page, "new-bill"); await shot(page.getByRole("dialog").or(page.locator("form").filter({ hasText: "Obligation title" })).first(), "el-new-bill");
    await page.keyboard.press("Escape"); await page.waitForTimeout(500);
    const cancel = page.getByRole("button", { name: "Cancel", exact: true }); if (await cancel.isVisible().catch(() => false)) await cancel.click();
  }
  if (want("payment")) {
    await page.getByRole("button", { name: "Review payment" }).first().click(); await page.waitForTimeout(900);
    const dialog = page.getByRole("dialog"); await shot(dialog, "el-pay-start");
    await dialog.getByRole("button", { name: "Review fresh payment proposal" }).click(); await page.waitForTimeout(1800);
    await shot(page, "pay-review"); await shot(dialog, "el-pay-review");
    await dialog.getByRole("button", { name: "Confirm full testnet payment" }).click().catch((e) => console.log("confirm", e.message)); await page.waitForTimeout(2500);
    await shot(page, "pay-done"); await shot(dialog, "el-pay-done");
    await page.keyboard.press("Escape"); await page.waitForTimeout(600);
  }
  if (want("pay-other")) {
    await page.getByRole("button", { name: /Pay AWS infrastructure from another chain/i }).click(); await page.waitForTimeout(1000);
    const dialog = page.getByRole("dialog"); await dialog.getByRole("combobox").selectOption("Base_Sepolia").catch(() => undefined); await page.waitForTimeout(500);
    await shot(page, "pay-other"); await shot(dialog, "el-pay-other");
    await page.keyboard.press("Escape"); await page.waitForTimeout(600);
  }
}
if (want("policy")) {
  await nav(page, "Policy");
  await shot(page, "policy"); await shot(page, "policy-full", { fullPage: true });
  await shot(section(page, "In plain language"), "el-plain"); await shot(section(page, "Checks today"), "el-checks");
  const form = section(page, "Edit policy");
  await page.getByLabel("Protection lead time").selectOption("CUSTOM").catch(() => undefined);
  for (const days of ["3", "7", "14", "21", "30"]) { await page.getByLabel("Protection lead days").fill(days); await page.mouse.click(1590, 990); await page.waitForTimeout(250); await shot(form, "el-policy-lead-" + days); }
  await page.getByLabel("Protection lead days").fill("7");
}
if (want("activity")) {
  await nav(page, "Activity");
  await shot(page, "activity"); await shot(section(page, "Decision ledger"), "el-ledger");
  await page.getByText("Autopilot invested idle budget").first().click().catch(() => undefined); await page.waitForTimeout(700);
  await shot(section(page, "Decision ledger"), "el-ledger-open");
}
if (want("connections")) {
  await nav(page, "Connections");
  // The connector URL is the page origin; show the production one instead of the local server.
  await page.evaluate(() => { const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); while (walker.nextNode()) { const node = walker.currentNode; if (node.nodeValue?.includes("127.0.0.1:3107")) node.nodeValue = node.nodeValue.replace("http://127.0.0.1:3107", "https://app.hoddfinance.xyz"); } });
  await shot(page, "connections"); await shot(section(page, "Use Hodd from Claude"), "el-claude");
}
if (want("autopilot")) {
  await nav(page, "Autopilot");
  await page.getByLabel("Amount (USDC)").fill("150").catch(() => undefined);
  await shot(page, "autopilot"); await shot(page, "autopilot-full", { fullPage: true });
  for (const name of ["Settings", "History"]) await page.getByText(name, { exact: true }).click().catch(() => undefined);
  await page.waitForTimeout(600); await shot(page, "autopilot-open-full", { fullPage: true });
  await page.getByText("Settings", { exact: true }).click().catch(() => undefined); await page.getByText("History", { exact: true }).click().catch(() => undefined);
  // An Autopilot run in progress: the server's steps move the rail.
  apGate.arm(); apStep = 0; await boot(page); await nav(page, "Autopilot");
  await page.getByLabel("Amount (USDC)").fill("150").catch(() => undefined);
  for (let step = 0; step <= 3; step++) {
    await page.waitForTimeout(1300);
    const rail = page.getByRole("region", { name: /progress/i }).first();
    await shot(page, "ap-run-" + step); await shot(rail, "el-ap-rail-" + step).catch((e) => console.log("rail", e.message));
    apGate.open(); apGate.arm(); await page.waitForTimeout(3600);
  }
  apGate.open();
}
if (want("hoddie")) {
  // Hoddie drafts changes through its model provider; the provider reply is replayed here as the route streams it.
  const tomorrow = new Date(now + DAY).toISOString().slice(0, 10);
  const proposal = { handle: "film-proposal", kind: "CREATE_OBLIGATION", summary: `Software licences: 500.00 USDC due ${tomorrow} (upcoming).`, lines: [`New obligation Software licences: 500.00 USDC due ${tomorrow} (upcoming).`, "Recipient: Design tools vendor"], expiresAt: new Date(now + 10 * 60_000).toISOString(),
    impact: [{ label: "Deployable capital", before: "18,720.50 USDC", after: "18,220.50 USDC" }, { label: "Protected capital", before: "11,700.00 USDC", after: "12,200.00 USDC" }, { label: "Coverage", before: "SAFE", after: "SAFE" }] };
  await page.route("**/api/hoddie/chat", async (route) => {
    if (route.request().method() === "GET") { await route.fulfill({ json: { providers: [{ id: "GEMINI", label: "Gemini", model: "Flash", ready: true, note: "" }] } }); return; }
    const body = route.request().postDataJSON() ?? {};
    if (!String(body.message ?? "").includes("due tomorrow")) { await route.fulfill({ status: 503, json: { status: "ERROR", code: "FILM", message: "Answered by the Treasury Engine." } }); return; }
    const result = { language: "en", message: "Review the exact change below. Nothing has been applied.", cards: [], source: "LIVE", observedAt: new Date().toISOString(), proposal, interpretedBy: "GEMINI" };
    const events = [{ type: "start", messageId: "film-message" }, { type: "data-hoddie", data: result }, { type: "finish" }];
    await route.fulfill({ status: 200, headers: { "content-type": "text/event-stream", "x-vercel-ai-ui-message-stream": "v1", "cache-control": "no-store" }, body: events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") + "data: [DONE]\n\n" });
  });
  await page.route("**/api/hoddie/confirm", async (route) => {
    live.mutate((current) => ({ ...current, obligations: [...current.obligations, { id: "software-licences", title: "Software licences", category: "SUBSCRIPTION", amount: usdc(500), dueAt: `${tomorrow}T17:00:00.000Z`, recipient: "Design tools vendor", priority: "NORMAL", status: "UPCOMING", description: "", recipientAddress: null, revision: 1 }] }));
    await route.fulfill({ json: { status: "READY", request: false } });
  });
  await page.setViewportSize({ width: 1600, height: 1240 });
  await boot(page); await nav(page, "Hoddie");
  await shot(page, "hoddie");
  const input = page.getByRole("textbox").last();
  const ask = async (question, name) => {
    const clear = page.getByRole("button", { name: /clear chat/i }); if (await clear.isEnabled().catch(() => false)) { await clear.click(); await page.waitForTimeout(500); }
    await input.fill(question); await page.waitForTimeout(300); await shot(page, name + "-typed");
    await page.getByRole("button", { name: "Send command" }).click(); await page.waitForTimeout(2200); await page.mouse.move(1599, 1239);
    await shot(page, name); await shot(section(page, "Treasury conversation"), "el-" + name);
  };
  await ask("Can I pay this week's bills?", "hoddie-1");
  await ask("How much can I safely invest?", "hoddie-2");
  await ask("Hesabımı özetle", "hoddie-3");
  await ask("Add a 500 USDC software bill due tomorrow", "hoddie-4");
  await page.getByRole("button", { name: "Apply change" }).click().catch((e) => console.log("apply", e.message)); await page.waitForTimeout(2500); await page.mouse.move(1599, 1239);
  await shot(page, "hoddie-5"); await shot(section(page, "Treasury conversation"), "el-hoddie-5");
  await page.setViewportSize({ width: 1600, height: 1000 });
}
await browser.close();
