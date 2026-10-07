// Arc's documented mempool floor is 20 Gwei. Values below it may be silently dropped.
export const ARC_MIN_GAS_PRICE_WEI = 20_000_000_000n;
export function boundedArcGasPrice(price: bigint) {
  if (price < 0n) throw new Error("Invalid gas price");
  const buffered = price * 2n;
  return buffered < ARC_MIN_GAS_PRICE_WEI ? ARC_MIN_GAS_PRICE_WEI : buffered;
}

/**
 * Price for a quoted Earn signature. The quote's ceiling already carries the 2x
 * buffer, so compare the raw network price with it (not a second 2x buffer)
 * and never sign above the approved ceiling.
 */
export function quotedSigningGasPrice(networkPrice: bigint, ceiling: bigint) {
  if (networkPrice < 0n || networkPrice > ceiling) throw new Error("FEE_RESERVE_EXCEEDED");
  const buffered = boundedArcGasPrice(networkPrice);
  return buffered < ceiling ? buffered : ceiling;
}

/**
 * Earn Kit cannot simulate a deposit before its approval exists and then quotes
 * ~265k gas. A fresh wallet's first routed deposit measured 446,538 on Arc
 * Testnet, so an unsimulated deposit reserves at least this much before buffering.
 */
export const UNSIMULATED_DEPOSIT_GAS_FLOOR = 500_000n;

/** Buffered gas limit for one quoted Earn step; `unsimulatedDeposit` = deposit quoted behind an approval. */
export function earnStepGasLimit(step: string, reported: bigint, unsimulatedDeposit: boolean) {
  const floor = unsimulatedDeposit && step.toLowerCase() === "deposit" && reported < UNSIMULATED_DEPOSIT_GAS_FLOOR;
  return bufferedEarnGasLimit(floor ? UNSIMULATED_DEPOSIT_GAS_FLOOR : reported);
}

/** Reserve 20% above the provider's gas estimate, using exact integer units. */
export function bufferedEarnGasLimit(estimate: bigint) {
  if (estimate <= 0n) throw new Error("Invalid gas estimate");
  return (estimate * 120n + 99n) / 100n;
}
