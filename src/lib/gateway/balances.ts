import "server-only";
import { createPublicClient, erc20Abi, getAddress, http } from "viem";
import { arcRpcUrl } from "@/lib/arc/rpc";
import { gatewayBalances } from "./api";
import { GATEWAY_CHAINS, type GatewayChain } from "./chains";
import type { UnifiedUsdcView } from "./models";

const money = (minor: bigint) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits: minor.toString() });

async function walletUsdc(chain: GatewayChain, address: `0x${string}`) {
  const rpc = chain.domain === 26 ? arcRpcUrl() : chain.rpc;
  const client = createPublicClient({ transport: http(rpc, { timeout: 6_000, retryCount: 0 }) });
  return client.readContract({ address: chain.usdc, abi: erc20Abi, functionName: "balanceOf", args: [address] });
}

/**
 * Read-only view of one address's USDC on every Gateway testnet: what sits in
 * the wallet on each chain, and what is already in Circle Gateway (spendable on
 * Arc in seconds). Each source fails independently and is reported, never guessed.
 */
export async function readUnifiedUsdc(walletAddress: string): Promise<UnifiedUsdcView> {
  const address = getAddress(walletAddress);
  const [gateway, wallets] = await Promise.all([
    gatewayBalances(address).then((value) => ({ ok: true as const, value }), () => ({ ok: false as const })),
    Promise.all(GATEWAY_CHAINS.map((chain) => walletUsdc(chain, address).then((value) => value, () => null))),
  ]);
  const chains = GATEWAY_CHAINS.map((chain, index) => {
    const wallet = wallets[index];
    const unified = gateway.ok ? gateway.value.get(chain.domain) ?? 0n : null;
    return { key: chain.key, label: chain.label, domain: chain.domain, nativeSymbol: chain.nativeSymbol, depositWait: chain.depositWait, wallet: wallet === null ? null : money(wallet), gateway: unified === null ? null : money(unified) };
  });
  const sum = (pick: (item: (typeof chains)[number]) => { minorUnits: string } | null) => money(chains.reduce((total, item) => total + BigInt(pick(item)?.minorUnits ?? "0"), 0n));
  const walletTotal = sum((item) => item.wallet); const gatewayTotal = sum((item) => item.gateway);
  return {
    address, observedAt: new Date().toISOString(), chains,
    totals: { wallet: walletTotal, gateway: gatewayTotal, all: money(BigInt(walletTotal.minorUnits) + BigInt(gatewayTotal.minorUnits)), offArcWallet: sum((item) => item.domain === 26 ? null : item.wallet) },
    gatewayStatus: gateway.ok ? "READY" : "UNAVAILABLE",
    unavailableChains: chains.filter((item) => item.wallet === null).map((item) => item.label),
  };
}
