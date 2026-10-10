import { encodeFunctionData, erc20Abi } from "viem";
import { GATEWAY_WALLET, type GatewayChain } from "./chains";

const gatewayWalletAbi = [{ type: "function", name: "deposit", stateMutability: "nonpayable", inputs: [{ name: "token", type: "address" }, { name: "value", type: "uint256" }], outputs: [] }] as const;

/**
 * Exact-amount approval, then GatewayWallet.deposit. A plain ERC-20 transfer to
 * the GatewayWallet loses the funds, so Hodd never builds one.
 */
export function gatewayDepositCalls(chain: GatewayChain, amountMinor: bigint) {
  if (amountMinor <= 0n) throw new Error("INVALID_AMOUNT");
  return [
    { to: chain.usdc, data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [GATEWAY_WALLET, amountMinor] }), value: "0" },
    { to: GATEWAY_WALLET, data: encodeFunctionData({ abi: gatewayWalletAbi, functionName: "deposit", args: [chain.usdc, amountMinor] }), value: "0" },
  ] as const;
}

/** "12.5" → 12500000n; at most 6 decimals, no signs or exponents. */
export function parseUsdcInput(value: string): bigint | null {
  const match = value.trim().match(/^(\d{1,12})(?:\.(\d{1,6}))?$/);
  if (!match) return null;
  return BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
}
