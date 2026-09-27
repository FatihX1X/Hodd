import "server-only";

import { createPublicClient, http } from "viem";
import { arcTestnet } from "viem/chains";
import { ARC_TESTNET_RPC_URL } from "./constants";
import { readArcTreasurySnapshot, type ArcReadClient } from "./reader-core";
import type { WalletSnapshot } from "@/lib/treasury/models";

export interface ArcTreasuryReader { readSnapshot(address: string): Promise<WalletSnapshot>; }

export class ViemArcTreasuryReader implements ArcTreasuryReader {
  private readonly client: ArcReadClient;
  constructor(rpcUrl = process.env.ARC_TESTNET_RPC_URL || ARC_TESTNET_RPC_URL) {
    this.client = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl, { timeout: 8_000, retryCount: 1 }) }) as ArcReadClient;
  }
  readSnapshot(address: string) { return readArcTreasurySnapshot(this.client, address); }
}
