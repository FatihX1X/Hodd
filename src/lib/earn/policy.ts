import type { EarnOperation } from "./models";
import type { Money, PolicyResult } from "@/lib/treasury/models";
import { addUsdc } from "./money";

export function evaluateEarnQuotePolicy(operation: EarnOperation, amount: Money, fees: readonly Money[], policyLimit: Money, warnings: readonly string[]): PolicyResult {
  if (amount.currency !== "USDC" || amount.decimals !== 6 || policyLimit.currency !== "USDC" || policyLimit.decimals !== 6) throw new Error("Earn policy requires 6-decimal USDC");
  if (BigInt(amount.minorUnits) <= 0n) return { status: "BLOCKED", label: "Earn policy", reason: "The operation amount must be greater than zero." };
  if (operation === "DEPOSIT") {
    const required = addUsdc([amount, ...fees]);
    if (BigInt(required.minorUnits) > BigInt(policyLimit.minorUnits)) return { status: "BLOCKED", label: "Earn policy", reason: "Deposit amount and estimated fees exceed deployable capital or the Morpho allocation cap." };
  } else if (BigInt(amount.minorUnits) > BigInt(policyLimit.minorUnits)) {
    return { status: "BLOCKED", label: "Earn policy", reason: "The requested withdrawal exceeds the safely withdrawable position." };
  }
  if (warnings.length) return { status: "REVIEW", label: "Earn policy", reason: "The quote contains liquidity or protocol warnings that require explicit acknowledgement." };
  return { status: "PASS", label: "Earn policy", reason: operation === "DEPOSIT" ? "The deposit preserves protected capital and remains within the Morpho allocation cap." : "The withdrawal is within the current position and liquidity limit." };
}

