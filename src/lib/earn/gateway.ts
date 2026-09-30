import "server-only";

import { AppKit } from "@circle-fin/app-kit";

import { createPublicClient, formatUnits, getAddress, http, isAddress } from "viem";
import { arcTestnet } from "viem/chains";
import { EARN_VAULT_ALLOWLIST, ARC_TESTNET_USDC, allowedVault, isAllowedVault } from "./allowlist";
import { decimalStringToMoney, minUsdc } from "./money";
import { earnPositionSchema, earnVaultSchema, type EarnPosition, type EarnVault } from "./models";

const kit = new AppKit();
const arcClient = createPublicClient({ chain: arcTestnet, transport: http("https://rpc.testnet.arc.io") });
const erc4626PositionAbi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "convertToAssets", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxWithdraw", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export class EarnGatewayError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

const operationConfig = () => process.env.CIRCLE_API_KEY?.trim() ? { apiKey: process.env.CIRCLE_API_KEY.trim() } : undefined;
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
  const address = getAddress(walletAddress);
  try {
    const blockNumber = await arcClient.getBlockNumber();
    if (await arcClient.getChainId() !== 5_042_002) throw new Error("Wrong network");
    const [shareBalance, shareDecimals] = await Promise.all([
      arcClient.readContract({ address: vault.address as `0x${string}`, abi: erc4626PositionAbi, functionName: "balanceOf", args: [address], blockNumber }),
      arcClient.readContract({ address: vault.address as `0x${string}`, abi: erc4626PositionAbi, functionName: "decimals", blockNumber }),
    ]);
    const [assets, withdrawable] = await Promise.all([
      arcClient.readContract({ address: vault.address as `0x${string}`, abi: erc4626PositionAbi, functionName: "convertToAssets", args: [shareBalance], blockNumber }),
      arcClient.readContract({ address: vault.address as `0x${string}`, abi: erc4626PositionAbi, functionName: "maxWithdraw", args: [address], blockNumber }),
    ]);
    const currentBalance = { currency: "USDC", decimals: 6, minorUnits: assets.toString() } as const;
    const maxWithdrawable = { currency: "USDC", decimals: 6, minorUnits: withdrawable.toString() } as const;
    const redeemable = minUsdc(currentBalance, maxWithdrawable, vault.liquidity);
    return earnPositionSchema.parse({ walletAddress: address, vaultAddress: vault.address, vaultName: vault.name, currentBalance, maxWithdrawable, redeemable, liquidityStatus: "READY", shares: formatUnits(shareBalance, shareDecimals), apyBps: vault.apyBps, pnl: { status: "UNAVAILABLE", reason: "Principal history is not inferred from public balance reads." }, observedAt: new Date().toISOString() });
  } catch { throw new EarnGatewayError("POSITION_UNAVAILABLE", "The Morpho position could not be read from Arc Testnet.", 503); }
}

export async function getEarnPortfolio(walletAddress?: string | null) {
  const vaults = await discoverAllowedVaults();
  const mode = process.env.NODE_ENV === "development" ? "READ_ONLY" as const : "PRODUCTION_DISABLED" as const;
  if (!walletAddress || !isAddress(walletAddress, { strict: false })) return { vaults, positions: [] as EarnPosition[], integration: { discovery: "READY" as const, positionAccess: "NOT_CONFIGURED" as const, execution: mode, configuredWalletAddress: null, message: "Vault discovery is live. Connect a user-owned wallet to load its public positions." } };
  const address = getAddress(walletAddress);
  const positions: EarnPosition[] = [];
  for (const vault of vaults) { try { positions.push(await getEarnPosition(address, vault)); } catch { /* one unavailable position must not hide verified vault discovery */ } }
  return { vaults, positions, integration: { discovery: "READY" as const, positionAccess: positions.length === vaults.length ? "READY" as const : "UNAVAILABLE" as const, execution: mode, configuredWalletAddress: null, message: positions.length === vaults.length ? "Live public positions are available for the selected user-owned wallet. Earn writes remain paused." : "Some vault positions could not be verified. Missing positions are excluded; treasury value may be incomplete." } };
}

export { EARN_VAULT_ALLOWLIST };
