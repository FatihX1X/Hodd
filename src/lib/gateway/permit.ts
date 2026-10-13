import "server-only";
import { domainSeparator, getAddress, parseAbi } from "viem";
import { gatewayChainClient } from "./balances";
import { GATEWAY_WALLET, type GatewayChain } from "./chains";

/** How long a Gateway deposit permit stays valid. The deposit is sent right after it is signed. */
export const PERMIT_TTL_SECONDS = 30 * 60;
const usdcPermitAbi = parseAbi([
  "function name() view returns (string)",
  "function version() view returns (string)",
  "function nonces(address owner) view returns (uint256)",
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
]);

export type GatewayPermit = { deadline: string; typedData: Record<string, unknown> };

/**
 * EIP-2612 permit for exactly `valueMinor` USDC to the GatewayWallet, so a Gateway deposit is one transaction
 * (`depositWithPermit`) instead of an approval plus a deposit. The domain is read from the token and must reproduce
 * its own DOMAIN_SEPARATOR; anything unexpected returns null and the caller falls back to approve + deposit.
 */
export async function gatewayDepositPermit(chain: GatewayChain, owner: string, valueMinor: bigint, now = Date.now()): Promise<GatewayPermit | null> {
  if (valueMinor <= 0n) return null;
  const client = gatewayChainClient(chain), account = getAddress(owner);
  const read = <T,>(functionName: "name" | "version" | "DOMAIN_SEPARATOR") => client.readContract({ address: chain.usdc, abi: usdcPermitAbi, functionName }) as Promise<T>;
  const [name, version, separator, nonce] = await Promise.all([read<string>("name"), read<string>("version"), read<`0x${string}`>("DOMAIN_SEPARATOR"), client.readContract({ address: chain.usdc, abi: usdcPermitAbi, functionName: "nonces", args: [account] })]);
  const domain = { name, version, chainId: chain.chainId, verifyingContract: chain.usdc };
  if (domainSeparator({ domain }).toLowerCase() !== separator.toLowerCase()) return null;
  const deadline = (BigInt(Math.floor(now / 1000)) + BigInt(PERMIT_TTL_SECONDS)).toString();
  return {
    deadline,
    typedData: {
      domain, primaryType: "Permit",
      types: {
        EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }],
        Permit: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }, { name: "value", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }],
      },
      message: { owner: account, spender: GATEWAY_WALLET, value: valueMinor.toString(), nonce: nonce.toString(), deadline },
    },
  };
}
