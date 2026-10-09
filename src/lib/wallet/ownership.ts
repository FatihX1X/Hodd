import { getAddress } from "viem";

/** A signed proof is only useful to the account it names, so no server nonce is needed. */
export const OWNERSHIP_VALIDITY_MS = 10 * 60_000;

export function ownershipMessage(userId: string, address: string, issuedAt: string) {
  return [
    "Hodd wallet ownership",
    `Account: ${userId}`,
    `Wallet: ${getAddress(address)}`,
    "Chain: Arc Testnet (5042002)",
    `Issued: ${issuedAt}`,
    "Signing proves you control this wallet. It is free and moves no funds.",
  ].join("\n");
}

export function ownershipIssuedAtValid(issuedAt: string, now = Date.now()) {
  const time = Date.parse(issuedAt);
  return Number.isFinite(time) && new Date(time).toISOString() === issuedAt && Math.abs(now - time) <= OWNERSHIP_VALIDITY_MS;
}
