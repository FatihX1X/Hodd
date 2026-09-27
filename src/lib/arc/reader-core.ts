import { erc20Abi, getAddress, isAddress, type Address } from "viem";
import { ARC_TESTNET_CHAIN_ID, ARC_USDC_ADDRESS, ARC_USDC_DECIMALS } from "./constants";
import { walletSnapshotSchema, type WalletSnapshot } from "@/lib/treasury/models";

export type ArcReadErrorCode = "INVALID_ADDRESS" | "WRONG_CHAIN" | "INVALID_USDC" | "RPC_UNAVAILABLE" | "INVALID_RESPONSE";

export class ArcReadError extends Error {
  constructor(public readonly code: ArcReadErrorCode, message: string) { super(message); this.name = "ArcReadError"; }
}

export type ArcReadClient = {
  getChainId(): Promise<number>;
  getBlockNumber(): Promise<bigint>;
  readContract(args: { address: Address; abi: typeof erc20Abi; functionName: "balanceOf"; args: readonly [Address]; blockNumber: bigint }): Promise<bigint>;
  readContract(args: { address: Address; abi: typeof erc20Abi; functionName: "decimals"; blockNumber: bigint }): Promise<number>;
};

export async function readArcTreasurySnapshot(client: ArcReadClient, rawAddress: string, now = new Date()): Promise<WalletSnapshot> {
  if (!isAddress(rawAddress, { strict: false })) throw new ArcReadError("INVALID_ADDRESS", "Enter a valid EVM wallet address.");
  const address = getAddress(rawAddress);
  try {
    const chainId = await client.getChainId();
    if (chainId !== ARC_TESTNET_CHAIN_ID) throw new ArcReadError("WRONG_CHAIN", `Expected Arc Testnet chain ${ARC_TESTNET_CHAIN_ID}, received ${chainId}.`);
    const blockNumber = await client.getBlockNumber();
    const [decimals, balance] = await Promise.all([
      client.readContract({ address: ARC_USDC_ADDRESS, abi: erc20Abi, functionName: "decimals", blockNumber }),
      client.readContract({ address: ARC_USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [address], blockNumber }),
    ]);
    if (decimals !== ARC_USDC_DECIMALS) throw new ArcReadError("INVALID_USDC", `Arc USDC reported ${decimals} decimals instead of ${ARC_USDC_DECIMALS}.`);
    return walletSnapshotSchema.parse({ address, chain: "ARC-TESTNET", chainId, balance: { currency: "USDC", minorUnits: balance.toString(), decimals }, blockNumber: blockNumber.toString(), observedAt: now.toISOString() });
  } catch (error) {
    if (error instanceof ArcReadError) throw error;
    throw new ArcReadError("RPC_UNAVAILABLE", "Arc Testnet did not return a verified USDC balance.");
  }
}
