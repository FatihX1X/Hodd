import "server-only";
import { erc20Abi, getAddress } from "viem";
import { arcClient, getEarnPosition } from "@/lib/earn/gateway";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
import type { EarnPosition, EarnVault } from "@/lib/earn/models";
import { readUsycStatus } from "@/lib/usyc/status";
import { USYC_TELLER, tellerAbi } from "@/lib/usyc/constants";
import { HODDIE_VAULT_FACTORY, LEGACY_VAULT_LIMITS, factoryAbi, strategyAbi, vaultAbi, vaultMatches, vaultParams, VAULT_MORPHO, VAULT_USYC_POOL, type VaultConfig, type VaultLimits } from "./vault";

/** The address the factory deploys this owner's vault to for this agent (whether or not it exists yet). */
export async function predictVault(owner: string, operator: string, limits?: VaultLimits) {
  return getAddress(await arcClient.readContract({ address: HODDIE_VAULT_FACTORY, abi: factoryAbi, functionName: "predictVault", args: vaultParams(owner, operator, limits) }));
}
/** Where a vault created before limits were dropped from new vaults would be. */
export const predictLegacyVault = (owner: string, operator: string) => predictVault(owner, operator, LEGACY_VAULT_LIMITS);

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

/** The deployed vault, refused unless its owner, operator, asset and strategies are the ones Hodd expects. */
export async function verifiedVault(vault: string, owner: string, operator: string) {
  if (!(await vaultDeployed(vault))) throw new Error("AGENT_VAULT_NOT_DEPLOYED");
  const config = await readVaultConfig(vault);
  if (!vaultMatches(config, owner, operator)) throw new Error("AGENT_VAULT_SETTINGS_CHANGED");
  return config;
}

/**
 * The vault's place in Hodd's USYC pool. ready: Circle permits the pool and the read is fresh, so it can be valued and
 * redeemed; depositRoomMinor is 0 while new deposits are closed. When Circle's side or the prices cannot be read, the
 * shares are still read (so a position is never taken for nothing) but nothing is valued, redeemable or depositable.
 */
export type VaultUsyc = { shares: bigint; valueMinor: bigint; redeemableMinor: bigint; redeemableShares: bigint; depositRoomMinor: bigint; ready: boolean; afterHoursPricing: boolean; observedAt: string; readable?: boolean };
export async function readVaultUsyc(vault: string, now = new Date()): Promise<VaultUsyc> {
  const read = await readUsycStatus(vault, now, VAULT_USYC_POOL).catch(() => null);
  if (!read) {
    const shares = await arcClient.readContract({ address: VAULT_USYC_POOL, abi: strategyAbi, functionName: "balanceOf", args: [getAddress(vault)] });
    return { shares, valueMinor: 0n, redeemableMinor: 0n, redeemableShares: 0n, depositRoomMinor: 0n, ready: false, afterHoursPricing: false, observedAt: now.toISOString(), readable: false };
  }
  const ready = read.circle === "OK";
  return { shares: BigInt(read.shares), valueMinor: BigInt(read.valueUsdc), redeemableMinor: ready ? BigInt(read.maxWithdrawUsdc) : 0n, redeemableShares: ready ? BigInt(read.maxWithdrawShares) : 0n, depositRoomMinor: ready && !read.depositsPaused ? BigInt(read.maxDepositUsdc) : 0n, ready, afterHoursPricing: read.afterHoursPricing, observedAt: read.observedAt, readable: true };
}

export type VaultFunds = { idle: { balance: { currency: "USDC"; decimals: 6; minorUnits: string }; observedAt: string }; position: EarnPosition; shares: bigint; usyc: VaultUsyc | null; depositRoomMinor: bigint; paymentRoomMinor: bigint };
/** Idle USDC, the Morpho position (same reader and redeemability proof as any wallet), the USYC pool position and the contract's budgets left. */
export async function readVaultFunds(vault: string, morpho: EarnVault): Promise<VaultFunds> {
  const address = getAddress(vault);
  if (getAddress(morpho.address) !== VAULT_MORPHO) throw new Error("AGENT_VAULT_CONFIGURATION_CHANGED");
  const [idle, position, shares, usyc, depositRoom, paymentRoom] = await Promise.all([
    arcClient.readContract({ address: ARC_TESTNET_USDC, abi: erc20Abi, functionName: "balanceOf", args: [address] }),
    getEarnPosition(address, morpho),
    arcClient.readContract({ address: VAULT_MORPHO, abi: strategyAbi, functionName: "balanceOf", args: [address] }),
    readVaultUsyc(address),
    arcClient.readContract({ address, abi: vaultAbi, functionName: "remainingDepositAllowance" }),
    arcClient.readContract({ address, abi: vaultAbi, functionName: "remainingPaymentAllowance" }),
  ]);
  return { idle: { balance: { currency: "USDC", decimals: 6, minorUnits: idle.toString() }, observedAt: new Date().toISOString() }, position, shares, usyc, depositRoomMinor: depositRoom, paymentRoomMinor: paymentRoom };
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
export const previewDeposit = (assets: bigint, strategy: `0x${string}` = VAULT_MORPHO) => arcClient.readContract({ address: strategy, abi: strategyAbi, functionName: "previewDeposit", args: [assets] });
export const previewWithdraw = (assets: bigint) => arcClient.readContract({ address: VAULT_MORPHO, abi: strategyAbi, functionName: "previewWithdraw", args: [assets] });
export const previewRedeem = (shares: bigint, strategy: `0x${string}` = VAULT_USYC_POOL) => arcClient.readContract({ address: strategy, abi: strategyAbi, functionName: "previewRedeem", args: [shares] });
export const convertToAssets = (shares: bigint) => arcClient.readContract({ address: VAULT_MORPHO, abi: strategyAbi, functionName: "convertToAssets", args: [shares] });

const YEAR_S = 365n * 86_400n;
/** About six days of Arc blocks: long enough to see the fund's daily accrual, short enough to stay current. */
const LOOKBACK_BLOCKS = 1_000_000n;
let usycYield: { at: number; bps: number | null } | null = null;
/**
 * USYC's recent yield in basis points a year, measured from Circle's own price: the Teller's redemption price now
 * against the same price about six days ago (a historical read), annualized simply. Cached for an hour; null when the
 * history cannot be read.
 */
export async function usycApyBps(nowMs = Date.now()): Promise<number | null> {
  if (usycYield && nowMs - usycYield.at < 3_600_000) return usycYield.bps;
  let bps: number | null = null;
  try {
    const head = await arcClient.getBlockNumber();
    const past = head - LOOKBACK_BLOCKS;
    const price = (blockNumber: bigint) => arcClient.readContract({ address: USYC_TELLER, abi: tellerAbi, functionName: "previewRedeemData", args: [VAULT_USYC_POOL, 1_000_000n], blockNumber }).then((data) => data[2]);
    const [now, then, headBlock, pastBlock] = await Promise.all([price(head), price(past), arcClient.getBlock({ blockNumber: head }), arcClient.getBlock({ blockNumber: past })]);
    const seconds = headBlock.timestamp - pastBlock.timestamp;
    if (now > 0n && then > 0n && seconds > 0n) bps = Number((now - then) * 10_000n * YEAR_S / (then * seconds));
  } catch { bps = null; }
  usycYield = { at: nowMs, bps };
  return bps;
}
