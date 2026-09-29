import "server-only";

import { AppKit, type EarnGasFeeEstimate } from "@circle-fin/app-kit";
import { createCircleWalletsAdapter } from "@circle-fin/adapter-circle-wallets";
import { getAddress, isAddress } from "viem";
import { EARN_VAULT_ALLOWLIST, ARC_TESTNET_USDC, allowedVault, isAllowedVault } from "./allowlist";
import { addUsdc, decimalStringToMoney, minUsdc, nativeWeiToUsdcCeil, type UsdcMoney } from "./money";
import { earnPositionSchema, earnVaultSchema, type EarnExecutionResult, type EarnOperation, type EarnPosition, type EarnQuote, type EarnVault } from "./models";
import { evaluateEarnQuotePolicy } from "./policy";
import { QUOTE_TTL_MS, earnQuoteStore } from "./quote-store";
import { executionMode } from "./security";
import { redeemAllSettlementStatus } from "./settlement";
import type { Money } from "@/lib/treasury/models";

const kit = new AppKit();
const UNKNOWN_GAS_RESERVE = { currency: "USDC", decimals: 6, minorUnits: "100000" } as const;

export class EarnGatewayError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

function credentials() {
  const apiKey = process.env.CIRCLE_API_KEY?.trim();
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET?.trim();
  const rawAddress = process.env.CIRCLE_WALLET_ADDRESS?.trim();
  const address = rawAddress && isAddress(rawAddress, { strict: false }) ? getAddress(rawAddress) : null;
  return { apiKey, entitySecret, address, ready: Boolean(apiKey && entitySecret && address) } as const;
}

function adapterFor(address: string) {
  const config = credentials();
  if (!config.ready || !config.apiKey || !config.entitySecret || !config.address) throw new EarnGatewayError("WALLET_NOT_CONFIGURED", "Circle Developer-Controlled Wallet credentials are not configured on this server.", 503);
  if (getAddress(address) !== config.address) throw new EarnGatewayError("WALLET_ADDRESS_MISMATCH", "The linked wallet does not match the configured Circle Developer-Controlled Wallet.", 409);
  return createCircleWalletsAdapter({ apiKey: config.apiKey, entitySecret: config.entitySecret });
}

const operationConfig = () => credentials().apiKey ? { apiKey: credentials().apiKey } : undefined;
const apyBps = (value: number) => Number.isFinite(value) ? Math.max(0, Math.round(value * 10_000)) : 0;

export async function discoverAllowedVaults(): Promise<EarnVault[]> {
  let result;
  try { result = await kit.earn.exploreVaults({ chain: "Arc_Testnet", protocol: "MORPHO", asset: "USDC", sortBy: "tvl", pageSize: 100, config: operationConfig() }); }
  catch { throw new EarnGatewayError("VAULT_DISCOVERY_UNAVAILABLE", "Arc Earn vault discovery is temporarily unavailable.", 503); }
  return result.vaults.filter((vault) => isAllowedVault(vault.address)).map((vault) => {
    const verification = allowedVault(vault.address);
    if (!verification || getAddress(vault.assetAddress) !== ARC_TESTNET_USDC || vault.chain !== "Arc_Testnet" || vault.protocol.toUpperCase() !== "MORPHO" || vault.asset.toUpperCase() !== "USDC") throw new EarnGatewayError("VAULT_VERIFICATION_FAILED", "An allowlisted vault no longer matches its verified Arc Testnet configuration.", 503);
    if (vault.liquidityProfile.status !== "active") throw new EarnGatewayError("VAULT_INACTIVE", "An allowlisted vault is no longer active.", 503);
    const redWarnings = (vault.riskSignals.warnings ?? []).filter((warning) => warning.level === "RED");
    if (redWarnings.length) throw new EarnGatewayError("VAULT_RED_WARNING", "An allowlisted vault now carries a blocking risk warning.", 503);
    return earnVaultSchema.parse({
      address: getAddress(vault.address), name: vault.name, chain: "ARC-TESTNET", protocol: "MORPHO", asset: "USDC", assetAddress: getAddress(vault.assetAddress),
      apyBps: apyBps(vault.apyProfile.current), totalDeposits: decimalStringToMoney(vault.liquidityProfile.totalDeposits), liquidity: decimalStringToMoney(vault.liquidityProfile.available),
      status: vault.liquidityProfile.status === "active" ? "ACTIVE" : "LOW_LIQUIDITY", circleGuarded: vault.riskSignals.circleSentinel,
      warnings: [...(vault.riskSignals.warnings ?? [])], earnKitWarnings: [...(vault.riskSignals.earnKitWarnings ?? [])], verifiedAt: verification.verifiedAt, verifiedBlock: verification.verifiedBlock,
    });
  });
}

export async function getEarnPosition(walletAddress: string, vault: EarnVault): Promise<EarnPosition> {
  const address = getAddress(walletAddress); const adapter = adapterFor(address);
  try {
    const position = await kit.earn.getPosition({ from: { adapter, chain: "Arc_Testnet", address }, vaultAddress: vault.address, config: operationConfig() });
    let maxWithdrawable = decimalStringToMoney("0"); let liquidityStatus: "READY" | "UNAVAILABLE" = "UNAVAILABLE";
    if (BigInt(decimalStringToMoney(position.currentBalance).minorUnits) > 0n) {
      try {
        const quote = await kit.earn.getWithdrawalQuote({ from: { adapter, chain: "Arc_Testnet", address }, vaultAddress: vault.address, amount: position.currentBalance, config: operationConfig() });
        maxWithdrawable = decimalStringToMoney(quote.maxWithdrawable.amount); liquidityStatus = "READY";
      } catch { /* fail closed: an unavailable fresh maximum contributes no redeemable liquidity */ }
    } else { liquidityStatus = "READY"; }
    const currentBalance = decimalStringToMoney(position.currentBalance);
    const redeemable = minUsdc(currentBalance, maxWithdrawable, vault.liquidity);
    const pnl = position.pnl.status === "available"
      ? { status: "AVAILABLE" as const, principalDeposited: decimalStringToMoney(position.pnl.principalDeposited), totalYieldEarned: decimalStringToMoney(position.pnl.totalYieldEarned, 6, true) }
      : position.pnl.status === "pending" ? { status: "PENDING" as const } : { status: "UNAVAILABLE" as const, reason: position.pnl.reason };
    return earnPositionSchema.parse({ walletAddress: address, vaultAddress: getAddress(position.vaultAddress), vaultName: position.vaultName, currentBalance, maxWithdrawable, redeemable, liquidityStatus, shares: position.shares, apyBps: apyBps(position.currentApy), pnl, observedAt: new Date().toISOString() });
  } catch { throw new EarnGatewayError("POSITION_UNAVAILABLE", "The Morpho position could not be read for the configured Circle wallet.", 503); }
}

export async function getEarnPortfolio(walletAddress?: string | null) {
  const vaults = await discoverAllowedVaults();
  const config = credentials(); const mode = executionMode();
  if (!walletAddress || !isAddress(walletAddress, { strict: false })) return { vaults, positions: [] as EarnPosition[], integration: { discovery: "READY" as const, positionAccess: "NOT_CONFIGURED" as const, execution: mode, configuredWalletAddress: config.address, message: "Vault discovery is live. Link the configured Developer-Controlled Wallet to load positions." } };
  const address = getAddress(walletAddress);
  if (!config.ready) return { vaults, positions: [] as EarnPosition[], integration: { discovery: "READY" as const, positionAccess: "NOT_CONFIGURED" as const, execution: mode, configuredWalletAddress: config.address, message: "Vault discovery is live; Circle credentials are required for position reads and execution." } };
  if (config.address !== address) return { vaults, positions: [] as EarnPosition[], integration: { discovery: "READY" as const, positionAccess: "ADDRESS_MISMATCH" as const, execution: mode, configuredWalletAddress: config.address, message: "The linked address is not the configured Developer-Controlled Wallet, so Morpho positions are excluded." } };
  const positions: EarnPosition[] = [];
  for (const vault of vaults) { try { positions.push(await getEarnPosition(address, vault)); } catch { /* one unavailable position must not hide verified vault discovery */ } }
  return { vaults, positions, integration: { discovery: "READY" as const, positionAccess: "READY" as const, execution: mode, configuredWalletAddress: config.address, message: mode === "LOCAL_ENABLED" ? "Live positions and local two-step execution are enabled." : "Live positions are available; transaction execution is read-only in this environment." } };
}

function sanitizeGasFees(entries: readonly EarnGasFeeEstimate[] | undefined) {
  return (entries ?? []).map((entry) => entry.fees === null ? { name: entry.name, amount: null, error: "Estimate available after the required approval step." } : { name: entry.name, amount: nativeWeiToUsdcCeil(entry.fees.fee) });
}

function quoteFeeTotal(fees: readonly { symbol: string; amount: string }[], gasFees: ReturnType<typeof sanitizeGasFees>): UsdcMoney {
  const protocolFees = fees.filter((fee) => fee.symbol.toUpperCase() === "USDC").map((fee) => decimalStringToMoney(fee.amount));
  const gas = gasFees.map((fee) => fee.amount ?? UNKNOWN_GAS_RESERVE);
  return addUsdc([...protocolFees, ...gas]);
}

export async function createEarnQuote(input: { operation: EarnOperation; walletAddress: string; vaultAddress: string; amount?: string; policyLimit: Money }): Promise<EarnQuote> {
  if (!isAllowedVault(input.vaultAddress)) throw new EarnGatewayError("VAULT_NOT_ALLOWED", "This vault is not in Hodd's verified server allowlist.");
  const address = getAddress(input.walletAddress); const vaultAddress = getAddress(input.vaultAddress); const adapter = adapterFor(address);
  const liveVault = (await discoverAllowedVaults()).find((vault) => vault.address === vaultAddress);
  if (!liveVault) throw new EarnGatewayError("VAULT_NOT_DISCOVERED", "The allowlisted vault is not currently available through Arc Earn.", 503);
  let amount: UsdcMoney | null = input.amount ? decimalStringToMoney(input.amount) : null;
  let expectedShares: string | null = null; let sharesToRedeem: string | null = null; let maxWithdrawable: UsdcMoney | null = null;
  let rawGasFees: readonly EarnGasFeeEstimate[] | undefined; let sdkFees: readonly { symbol: string; amount: string }[] = []; let warnings: string[] = [...liveVault.earnKitWarnings, ...liveVault.warnings.map((warning) => `${warning.level}: ${warning.type}`)];
  try {
    if (input.operation === "REDEEM_ALL") { const position = await kit.earn.getPosition({ from: { adapter, chain: "Arc_Testnet", address }, vaultAddress, config: operationConfig() }); amount = decimalStringToMoney(position.currentBalance); }
    if (!amount || BigInt(amount.minorUnits) <= 0n) throw new EarnGatewayError("INVALID_AMOUNT", "Enter an amount greater than zero with no more than 6 decimals.");
    if (input.operation === "DEPOSIT") {
      const sdkQuote = await kit.earn.getDepositQuote({ from: { adapter, chain: "Arc_Testnet", address }, vaultAddress, amount: input.amount!, config: operationConfig() });
      expectedShares = sdkQuote.expectedShares.amount; rawGasFees = sdkQuote.gasFees; sdkFees = sdkQuote.fees;
    } else {
      const sdkQuote = await kit.earn.getWithdrawalQuote({ from: { adapter, chain: "Arc_Testnet", address }, vaultAddress, amount: `${BigInt(amount.minorUnits) / 1_000_000n}.${(BigInt(amount.minorUnits) % 1_000_000n).toString().padStart(6, "0")}`, config: operationConfig() });
      amount = decimalStringToMoney(sdkQuote.withdrawal.amount); sharesToRedeem = sdkQuote.sharesToRedeem.amount; maxWithdrawable = decimalStringToMoney(sdkQuote.maxWithdrawable.amount); rawGasFees = sdkQuote.gasFees; sdkFees = sdkQuote.fees; warnings = [...warnings, ...(sdkQuote.earnKitWarnings ?? [])];
    }
  } catch (error) { if (error instanceof EarnGatewayError) throw error; throw new EarnGatewayError("QUOTE_UNAVAILABLE", "A fresh Arc Earn quote could not be prepared. No transaction was submitted.", 503); }
  const gasFees = sanitizeGasFees(rawGasFees); if (gasFees.some((fee) => !fee.amount)) warnings.push("One gas estimate becomes available after the required approval; a conservative 0.10 USDC reserve is applied.");
  const fees = quoteFeeTotal(sdkFees, gasFees); const policyLimit = input.operation === "DEPOSIT" || !maxWithdrawable ? input.policyLimit : minUsdc(input.policyLimit, maxWithdrawable); const policy = evaluateEarnQuotePolicy(input.operation, amount, [fees], policyLimit, warnings);
  const executable = policy.status !== "BLOCKED"; const quoteId = executable ? crypto.randomUUID() : null; const expiresAt = executable ? new Date(Date.now() + QUOTE_TTL_MS).toISOString() : null;
  const quote: EarnQuote = { quoteId, operation: input.operation, walletAddress: address, vaultAddress, vaultName: allowedVault(vaultAddress)?.name ?? "Morpho USDC Vault", amount, expectedShares, sharesToRedeem, maxWithdrawable, fees, gasFees, warnings, policy, expiresAt, requiresWarningAcknowledgement: warnings.length > 0 };
  if (executable) earnQuoteStore.put({ quote, rawGasFees });
  return quote;
}

export async function executeEarnQuote(quoteId: string, warningsAcknowledged: boolean): Promise<EarnExecutionResult> {
  let stored; try { stored = earnQuoteStore.take(quoteId, warningsAcknowledged); } catch (error) {
    const code = error instanceof Error ? error.message : "QUOTE_NOT_AVAILABLE";
    throw new EarnGatewayError(code, code === "WARNINGS_NOT_ACKNOWLEDGED" ? "Acknowledge the quote warnings before execution." : "The quote expired or was already used. Request a fresh quote.", 409);
  }
  const { quote } = stored; const adapter = adapterFor(quote.walletAddress); const from = { adapter, chain: "Arc_Testnet" as const, address: quote.walletAddress };
  try {
    const amount = `${BigInt(quote.amount.minorUnits) / 1_000_000n}.${(BigInt(quote.amount.minorUnits) % 1_000_000n).toString().padStart(6, "0")}`;
    const result = quote.operation === "DEPOSIT"
      ? await kit.earn.deposit({ from, vaultAddress: quote.vaultAddress, amount, gasFees: stored.rawGasFees as readonly EarnGasFeeEstimate[] | undefined, config: operationConfig() })
      : await kit.earn.withdraw({ from, vaultAddress: quote.vaultAddress, amount, config: operationConfig() });
    if (!("txHash" in result)) throw new EarnGatewayError("UNEXPECTED_EXECUTION_RESULT", "Earn returned an unexpected execution result.", 502);
    let residualPosition: EarnPosition | null = null; let status: EarnExecutionResult["status"] = "COMPLETE";
    if (quote.operation === "REDEEM_ALL") {
      try { const vaults = await discoverAllowedVaults(); const vault = vaults.find((item) => item.address === quote.vaultAddress); if (vault) residualPosition = await getEarnPosition(quote.walletAddress, vault); status = redeemAllSettlementStatus(residualPosition); } catch { status = redeemAllSettlementStatus(null, false); }
    }
    return { executionId: crypto.randomUUID(), operation: quote.operation, status, txHash: result.txHash, explorerUrl: result.explorerUrl, vaultAddress: getAddress(result.vaultAddress), amount: decimalStringToMoney(result.amount), residualPosition };
  } catch (error) { if (error instanceof EarnGatewayError) throw error; throw new EarnGatewayError("EXECUTION_STATUS_UNKNOWN", "The Earn operation did not return a confirmed result. Do not retry until the wallet and explorer are checked.", 502); }
}

export function configuredWalletAddress() { return credentials().address; }
export { EARN_VAULT_ALLOWLIST };
