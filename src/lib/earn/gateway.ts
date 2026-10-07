import "server-only";

import { AppKit } from "@circle-fin/app-kit";

import { createPublicClient, formatUnits, getAddress, http, isAddress } from "viem";
import { arcTestnet } from "viem/chains";
import { EARN_VAULT_ALLOWLIST, ARC_TESTNET_USDC, allowedVault, isAllowedVault } from "./allowlist";
import { decimalStringToMoney, minUsdc } from "./money";
import { earnPositionSchema, earnVaultSchema, type EarnPosition, type EarnVault } from "./models";
import { executionMode } from "./security";

export const earnKit = new AppKit();
const kit = earnKit;
export const arcClient = createPublicClient({ chain: arcTestnet, transport: http("https://rpc.testnet.arc.io", { timeout: 10_000, retryCount: 0 }) });
const erc4626PositionAbi = [
  { type: "function", name: "asset", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "decimals", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { type: "function", name: "convertToAssets", stateMutability: "view", inputs: [{ name: "shares", type: "uint256" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "maxWithdraw", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
  { type: "function", name: "withdraw", stateMutability: "nonpayable", inputs: [{ name: "assets", type: "uint256" }, { name: "receiver", type: "address" }, { name: "owner", type: "address" }], outputs: [{ type: "uint256" }] },
] as const;

export class EarnGatewayError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

export const operationConfig = () => process.env.CIRCLE_API_KEY?.trim() ? { apiKey: process.env.CIRCLE_API_KEY.trim() } : undefined;
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
    const [shareBalance, shareDecimals, asset] = await Promise.all([
      arcClient.readContract({ address: vault.address as `0x${string}`, abi: erc4626PositionAbi, functionName: "balanceOf", args: [address], blockNumber }),
      arcClient.readContract({ address: vault.address as `0x${string}`, abi: erc4626PositionAbi, functionName: "decimals", blockNumber }),
      arcClient.readContract({ address: vault.address as `0x${string}`, abi: erc4626PositionAbi, functionName: "asset", blockNumber }),
    ]);
    if (getAddress(asset) !== ARC_TESTNET_USDC) throw new Error("Non-canonical vault asset");
    const [assets, reportedMax] = await Promise.all([
      arcClient.readContract({ address: vault.address as `0x${string}`, abi: erc4626PositionAbi, functionName: "convertToAssets", args: [shareBalance], blockNumber }),
      arcClient.readContract({ address: vault.address as `0x${string}`, abi: erc4626PositionAbi, functionName: "maxWithdraw", args: [address], blockNumber }),
    ]);
    // Morpho Vault V2 always reports maxWithdraw = 0. Prove the full position
    // is withdrawable at the same block with an eth_call; failure stays at 0.
    const withdrawable = reportedMax === 0n && assets > 0n
      ? await arcClient.simulateContract({ address: vault.address as `0x${string}`, abi: erc4626PositionAbi, functionName: "withdraw", args: [assets, address, address], account: address, blockNumber }).then(() => assets, () => 0n)
      : reportedMax;
    const currentBalance = { currency: "USDC", decimals: 6, minorUnits: assets.toString() } as const;
    const maxWithdrawable = { currency: "USDC", decimals: 6, minorUnits: withdrawable.toString() } as const;
    const redeemable = minUsdc(currentBalance, maxWithdrawable, vault.liquidity);
    return earnPositionSchema.parse({ walletAddress: address, vaultAddress: vault.address, vaultName: vault.name, currentBalance, maxWithdrawable, redeemable, liquidityStatus: "READY", shares: formatUnits(shareBalance, shareDecimals), apyBps: vault.apyBps, pnl: { status: "UNAVAILABLE", reason: "Principal history is not inferred from public balance reads." }, observedAt: new Date().toISOString() });
  } catch { throw new EarnGatewayError("POSITION_UNAVAILABLE", "The Morpho position could not be read from Arc Testnet.", 503); }
}

export async function getEarnPortfolio(walletAddress?: string | null) {
  const vaults = await discoverAllowedVaults();
  const mode = executionMode();
  if (!walletAddress || !isAddress(walletAddress, { strict: false })) return { vaults, positions: [] as EarnPosition[], integration: { discovery: "READY" as const, positionAccess: "NOT_CONFIGURED" as const, execution: mode, configuredWalletAddress: null, message: "Vault discovery is live. Connect a user-owned wallet to load its public positions." } };
  const address = getAddress(walletAddress);
  const positions: EarnPosition[] = [];
  for (const vault of vaults) { try { positions.push(await getEarnPosition(address, vault)); } catch { /* one unavailable position must not hide verified vault discovery */ } }
  return { vaults, positions, integration: { discovery: "READY" as const, positionAccess: positions.length === vaults.length ? "READY" as const : "UNAVAILABLE" as const, execution: mode, configuredWalletAddress: null, message: positions.length === vaults.length ? "Live positions are available. Earn requires a fresh server-policy quote, separate confirmation and user-owned signing; each provider is awaiting live verification." : "Some vault positions could not be verified. Missing positions are excluded; treasury value may be incomplete." } };
}

export { EARN_VAULT_ALLOWLIST };
