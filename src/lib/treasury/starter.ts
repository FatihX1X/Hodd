import { usdc } from "./fixtures";
import { treasuryWorkspaceSchema, type TreasuryWorkspace } from "./models";

/** An empty user treasury. LOCAL_DEMO is the schema's disconnected-wallet state. */
export function createLiveStarterWorkspace(now: Date | string = new Date()): TreasuryWorkspace {
  const updatedAt = new Date(now).toISOString();
  return treasuryWorkspaceSchema.parse({
    schemaVersion: 4,
    updatedAt,
    treasuryMode: "LOCAL_DEMO",
    walletConnection: null,
    totalTreasury: usdc("0"), liquidUsdc: usdc("0"), pendingTransactions: usdc("0"),
    obligations: [], decisions: [], paymentReservations: [],
    policy: { safetyBuffer: usdc("1000000"), minimumLiquidityCoverageBps: 10000, obligationHorizonDays: 30,
      strategyCapsBps: { LIQUID: 10000, MORPHO: 6000, USYC: 0, BTC_RESERVE: 0 },
      enabledStrategies: { LIQUID: true, MORPHO: true, USYC: false, BTC_RESERVE: false },
      liquidityWaterfall: ["LIQUID_USDC", "MORPHO", "USYC", "BTC_CREDIT", "BTC_SALE"] },
    targetAllocationsBps: { LIQUID: 5000, MORPHO: 5000, USYC: 0, BTC_RESERVE: 0 },
    strategies: [
      { id: "liquid-usdc", name: "Liquid USDC", kind: "LIQUID", balance: usdc("0"), redeemable: usdc("0"), apyBps: null, risk: "LOW", liquidity: "INSTANT", integration: "UNAVAILABLE" },
      { id: "morpho-usdc", name: "Morpho USDC Vault", kind: "MORPHO", balance: usdc("0"), redeemable: usdc("0"), apyBps: null, risk: "MODERATE", liquidity: "VARIABLE", integration: "UNAVAILABLE" },
      { id: "usyc-reserve", name: "USYC Reserve · Not available on Arc Testnet", kind: "USYC", balance: usdc("0"), redeemable: usdc("0"), apyBps: null, risk: "LOW", liquidity: "RESTRICTED", integration: "UNAVAILABLE" },
      { id: "btc-reserve", name: "BTC Reserve · Not available on Arc Testnet", kind: "BTC_RESERVE", balance: usdc("0"), redeemable: usdc("0"), apyBps: null, risk: "HIGH", liquidity: "VARIABLE", integration: "UNAVAILABLE" },
    ],
    integrations: [
      { name: "User wallet", status: "NOT_CONNECTED", message: "Connect your own wallet. Your wallet signs every transaction; Hodd stores public metadata only." },
      { name: "Arc Testnet", status: "NOT_CONNECTED", message: "Arc Testnet only · chain 5042002 · USDC. Live balances appear after you connect a wallet." },
      { name: "Morpho", status: "NOT_CONNECTED", message: "Live vault APY and positions load after wallet connection. Deposits require your wallet approval." },
      { name: "USYC / BTC", status: "UNAVAILABLE", message: "Not available on Arc Testnet. Allocation targets and caps are zero." },
    ],
    activities: [{ id: "workspace-created", occurredAt: updatedAt, actor: "SYSTEM", action: "Workspace created", summary: "Your live Arc Testnet treasury starts empty.", reason: "Connect your own wallet and add your bills to begin.", policy: { status: "NOT_EVALUATED", label: "Wallet required", reason: "Financial calculations wait for a verified live balance." }, approval: "NOT_REQUIRED", execution: "NOT_STARTED" }],
  });
}
