import "server-only";
import { erc20Abi, getAddress } from "viem";
import { arcClient, getEarnPosition } from "@/lib/earn/gateway";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
import type { EarnPosition, EarnVault } from "@/lib/earn/models";
import { HODDIE_VAULT_FACTORY, factoryAbi, strategyAbi, vaultAbi, vaultMatches, vaultParams, VAULT_MORPHO, type VaultConfig } from "./vault";

/** The address the factory deploys this owner's vault to for this agent (whether or not it exists yet). */
export async function predictVault(owner: string, operator: string) {
  return getAddress(await arcClient.readContract({ address: HODDIE_VAULT_FACTORY, abi: factoryAbi, functionName: "predictVault", args: vaultParams(owner, operator) }));
}

export async function vaultDeployed(vault: string) {
  const code = await arcClient.getCode({ address: getAddress(vault) });
  return Boolean(code && code !== "0x");
}

export async function readVaultConfig(vault: string): Promise<VaultConfig> {
  const address = getAddress(vault);
  const read = <T,>(functionName: "owner" | "operator" | "paused" | "asset" | "maxDepositPerTx" | "depositLimit24h" | "maxPaymentPerTx" | "paymentLimit24h" | "strategies") => arcClient.readContract({ address, abi: vaultAbi, functionName }) as Promise<T>;
  const [owner, operator, paused, asset, maxDepositPerTx, depositLimit24h, maxPaymentPerTx, paymentLimit24h, strategies] = await Promise.all([
    read<`0x${string}`>("owner"), read<`0x${string}`>("operator"), read<boolean>("paused"), read<`0x${string}`>("asset"),
    read<bigint>("maxDepositPerTx"), read<bigint>("depositLimit24h"), read<bigint>("maxPaymentPerTx"), read<bigint>("paymentLimit24h"), read<readonly `0x${string}`[]>("strategies"),
  ]);
  return { owner, operator, paused, asset, limits: { maxDepositPerTx, depositLimit24h, maxPaymentPerTx, paymentLimit24h }, strategies: [...strategies] };
}

/** The deployed vault, refused unless its settings are exactly the ones Hodd predicts for this owner and agent. */
export async function verifiedVault(vault: string, owner: string, operator: string) {
  if (!(await vaultDeployed(vault))) throw new Error("AGENT_VAULT_NOT_DEPLOYED");
  const config = await readVaultConfig(vault);
  if (!vaultMatches(config, owner, operator)) throw new Error("AGENT_VAULT_SETTINGS_CHANGED");
  return config;
}

export type VaultFunds = { idle: { balance: { currency: "USDC"; decimals: 6; minorUnits: string }; observedAt: string }; position: EarnPosition; shares: bigint; depositRoomMinor: bigint; paymentRoomMinor: bigint };
/** Idle USDC, the Morpho position (same reader and redeemability proof as any wallet) and the contract's budgets left. */
export async function readVaultFunds(vault: string, morpho: EarnVault): Promise<VaultFunds> {
  const address = getAddress(vault);
  if (getAddress(morpho.address) !== VAULT_MORPHO) throw new Error("AGENT_VAULT_CONFIGURATION_CHANGED");
  const [idle, position, shares, depositRoom, paymentRoom] = await Promise.all([
    arcClient.readContract({ address: ARC_TESTNET_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    getEarnPosition(address, morpho),
    arcClient.readContract({ address: VAULT_MORPHO, abi: strategyAbi, functionName: "balanceOf", args: [address] }),
    arcClient.readContract({ address, abi: vaultAbi, functionName: "remainingDepositAllowance" }),
    arcClient.readContract({ address, abi: vaultAbi, functionName: "remainingPaymentAllowance" }),
  ]);
  return { idle: { balance: { currency: "USDC", decimals: 6, minorUnits: idle.toString() }, observedAt: new Date().toISOString() }, position, shares, depositRoomMinor: depositRoom, paymentRoomMinor: paymentRoom };
}

/** Whether the owner approved each recipient on the vault, and the cap per payment they signed. */
export async function readRecipients(vault: string, recipients: string[]) {
  const address = getAddress(vault);
  const unique = [...new Set(recipients.map((item) => getAddress(item)))];
  const rows = await Promise.all(unique.map(async (recipient) => {
    const [approved, cap] = await Promise.all([
      arcClient.readContract({ address, abi: vaultAbi, functionName: "isRecipient", args: [recipient] }),
      arcClient.readContract({ address, abi: vaultAbi, functionName: "recipientCap", args: [recipient] }),
    ]);
    return [recipient, { approved, capMinor: cap }] as const;
  }));
  return new Map(rows);
}

/** Strategy previews used to bound slippage on each operator call. */
export const previewDeposit = (assets: bigint) => arcClient.readContract({ address: VAULT_MORPHO, abi: strategyAbi, functionName: "previewDeposit", args: [assets] });
export const previewWithdraw = (assets: bigint) => arcClient.readContract({ address: VAULT_MORPHO, abi: strategyAbi, functionName: "previewWithdraw", args: [assets] });
export const convertToAssets = (shares: bigint) => arcClient.readContract({ address: VAULT_MORPHO, abi: strategyAbi, functionName: "convertToAssets", args: [shares] });
