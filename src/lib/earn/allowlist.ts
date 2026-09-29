import { getAddress } from "viem";

export const ARC_TESTNET_USDC = getAddress("0x3600000000000000000000000000000000000000");

export const EARN_VAULT_ALLOWLIST = [{
  address: getAddress("0xaabbef1d3971c710276ed41ec791bbe14cdb8e88"),
  name: "EarnKit USDC Vault (Arc Testnet)",
  chainId: 5_042_002,
  protocol: "MORPHO",
  assetAddress: ARC_TESTNET_USDC,
  verifiedAt: "2026-09-28T16:14:39.000Z",
  verifiedBlock: "64465893",
  verification: "Circle App Kit discovery; deployed bytecode; canonical Arc Testnet USDC; 9,993,836,430,050,205 dead shares; no RED warning",
}] as const;

export function isAllowedVault(address: string) {
  try { const normalized = getAddress(address); return EARN_VAULT_ALLOWLIST.some((vault) => vault.address === normalized); }
  catch { return false; }
}

export function allowedVault(address: string) {
  const normalized = getAddress(address);
  return EARN_VAULT_ALLOWLIST.find((vault) => vault.address === normalized) ?? null;
}
