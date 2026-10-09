import "server-only";

import { createPublicClient, http } from "viem";
import { arcTestnet } from "viem/chains";
import { arcRpcUrl } from "./rpc";
import { readArcTreasurySnapshot, type ArcReadClient } from "./reader-core";
import type { WalletSnapshot } from "@/lib/treasury/models";

export interface ArcTreasuryReader { readSnapshot(address: string): Promise<WalletSnapshot>; }

export class ViemArcTreasuryReader implements ArcTreasuryReader {
  private readonly client: ArcReadClient;
  constructor(rpcUrl = arcRpcUrl()) {
    this.client = createPublicClient({ chain: arcTestnet, transport: http(rpcUrl, { timeout: 8_000, retryCount: 1 }) }) as ArcReadClient;
  }
  readSnapshot(address: string) { return readArcTreasurySnapshot(this.client, address); }
}
