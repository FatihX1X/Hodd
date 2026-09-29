import type { EarnPosition } from "./models";

export function redeemAllSettlementStatus(position: EarnPosition | null, positionReadSucceeded = true) {
  if (!positionReadSucceeded) return "UNKNOWN" as const;
  return position && BigInt(position.shares.replace(".", "")) > 0n ? "PARTIAL" as const : "COMPLETE" as const;
}
