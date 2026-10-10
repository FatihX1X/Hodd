import { getAddress } from "viem";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
/** Only the canonical Arc token and the exact, proven owner bound to this agent. */
export function assertAgentDestination(input: { token: string; destination: string; verifiedOwner: string | null; boundOwner: string; chainId: number }) {
  if (input.chainId !== 5042002 || !input.verifiedOwner || getAddress(input.token) !== ARC_TESTNET_USDC || getAddress(input.destination) !== getAddress(input.verifiedOwner) || getAddress(input.boundOwner) !== getAddress(input.verifiedOwner)) throw new Error("AGENT_DESTINATION_REFUSED");
}
