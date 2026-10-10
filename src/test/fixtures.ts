import { treasuryWorkspaceSchema, type Money } from "@/lib/treasury/models";

export const usdc = (minorUnits: string): Money => ({ currency: "USDC", minorUnits, decimals: 6 });
export const initialWorkspace = treasuryWorkspaceSchema.parse({
  schemaVersion: 4, treasuryMode: "LOCAL_DEMO", walletConnection: null, updatedAt: "2026-09-27T09:30:00.000Z", totalTreasury: usdc("10000000000"), liquidUsdc: usdc("10000000000"), pendingTransactions: usdc("0"),
  policy: { safetyBuffer: usdc("1000000000"), minimumLiquidityCoverageBps: 10000, obligationHorizonDays: 30,
    strategyCapsBps: { LIQUID: 10000, MORPHO: 6000, USYC: 0, BTC_RESERVE: 0 }, enabledStrategies: { LIQUID: true, MORPHO: true, USYC: false, BTC_RESERVE: false },
    liquidityWaterfall: ["LIQUID_USDC", "MORPHO", "USYC", "BTC_CREDIT", "BTC_SALE"] },
  targetAllocationsBps: { LIQUID: 2000, MORPHO: 5000, USYC: 2000, BTC_RESERVE: 1000 },
  obligations: [
    { id: "obl-payroll-oct", title: "October payroll", category: "PAYROLL", amount: usdc("4000000000"), dueAt: "2026-10-04T17:00:00.000Z", recipient: "Payroll batch · 8 recipients", priority: "CRITICAL", status: "UPCOMING", description: "Monthly payroll reserve for the core team." },
    { id: "obl-aws-oct", title: "AWS infrastructure", category: "SUBSCRIPTION", amount: usdc("500000000"), dueAt: "2026-10-08T17:00:00.000Z", recipient: "Vendor address not connected", priority: "HIGH", status: "UPCOMING", description: "Estimated monthly cloud bill." },
    { id: "obl-invoice-104", title: "Invoice #104", category: "VENDOR", amount: usdc("2000000000"), dueAt: "2026-10-12T17:00:00.000Z", recipient: "0x••••••••A104 · unverified demo", priority: "NORMAL", status: "DRAFT", description: "Draft vendor invoice. Draft obligations are not protected until activated." },
  ],
  strategies: [
    { id: "liquid-usdc", name: "Liquid USDC", kind: "LIQUID", balance: usdc("10000000000"), redeemable: usdc("10000000000"), apyBps: null, risk: "LOW", liquidity: "INSTANT", integration: "DEMO" },
    { id: "morpho-usdc", name: "Morpho USDC Vault", kind: "MORPHO", balance: usdc("0"), redeemable: usdc("0"), apyBps: 412, risk: "MODERATE", liquidity: "VARIABLE", integration: "DEMO" },
    { id: "usyc-reserve", name: "USYC Reserve", kind: "USYC", balance: usdc("0"), redeemable: usdc("0"), apyBps: null, risk: "LOW", liquidity: "RESTRICTED", integration: "UNAVAILABLE" },
    { id: "btc-reserve", name: "BTC Reserve", kind: "BTC_RESERVE", balance: usdc("0"), redeemable: usdc("0"), apyBps: null, risk: "HIGH", liquidity: "VARIABLE", integration: "FUTURE" },
  ],
  activities: [
    { id: "act-1", occurredAt: "2026-09-27T09:30:00.000Z", actor: "SYSTEM", action: "Treasury Engine baseline evaluated", summary: "4,500 USDC is protected for active obligations and 1,000 USDC for the safety buffer.", reason: "Stage 2 evaluates the sample workspace with deterministic minor-unit arithmetic.", policy: { status: "PASS", label: "Liquidity policy", reason: "The baseline workspace satisfies the configured liquidity floor." }, approval: "NOT_REQUIRED", execution: "LOCAL_ONLY" },
    { id: "act-2", occurredAt: "2026-09-27T09:14:00.000Z", actor: "HUMAN", action: "Safety buffer recorded", summary: "Local safety buffer set to 1,000 USDC.", reason: "User-authored workspace policy.", policy: { status: "PASS", label: "Local policy", reason: "The value was validated before it was stored." }, approval: "NOT_REQUIRED", execution: "LOCAL_ONLY" },
  ],
  decisions: [{ id: "decision-1", createdAt: "2026-09-27T09:30:00.000Z", title: "Preserve the payment runway", summary: "Keep obligations and the safety buffer protected before reviewing any investment.", rationale: "Payment readiness has priority over yield.", policy: { status: "PASS", label: "Liquidity check", reason: "Protected capital is calculated by the Treasury Engine." } }],
  integrations: [
    { name: "User wallet", status: "NOT_CONNECTED", message: "Choose Circle embedded, passkey, MetaMask or Rabby. The selected wallet remains user-controlled." },
    { name: "Arc Testnet", status: "NOT_CONNECTED", message: "A server-only read adapter is ready; no RPC request is made until a wallet is linked." },
    { name: "Morpho", status: "NOT_CONNECTED", message: "Arc Earn vault discovery and public position reads are available after a user wallet is connected." },
  ],
});

export const sampleWorkspace = initialWorkspace;
