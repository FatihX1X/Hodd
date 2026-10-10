import { createHash } from "node:crypto";
import type { CreateWalletsInput, CreateWalletSetInput } from "@circle-fin/developer-controlled-wallets";
/** A stable UUID with v4/variant bits; Circle requires UUID-v4 idempotency keys. */
export function agentIdempotencyKey(namespace: string, value: string) {
  const bytes = createHash("sha256").update("hodd-autopilot-v1:" + namespace + ":" + value).digest().subarray(0,16);
  bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex"); return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join("-");
}
export interface WalletCreator { createWalletSet(input: CreateWalletSetInput): Promise<{data?: {walletSet?: {id: string}}}>; createWallets(input: CreateWalletsInput): Promise<{data?: {wallets?: {id: string; address: string; blockchain: string; accountType: string}[]}}>; }
export async function createAgentWallet(circle: WalletCreator, userId: string, walletSetId: string, accountType: "EOA" | "SCA") {
  const response = await circle.createWallets({ walletSetId, accountType, blockchains: ["ARC-TESTNET"], count: 1, idempotencyKey: agentIdempotencyKey("wallet",userId), metadata: [{name:"Hodd agent", refId: userId}] });
  const wallet = response.data?.wallets?.[0];
  if (!wallet || wallet.blockchain !== "ARC-TESTNET" || wallet.accountType !== accountType) throw new Error("AGENT_WALLET_NOT_VERIFIED");
  return wallet;
}
