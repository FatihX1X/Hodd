// Arc's documented mempool floor is 20 Gwei. Values below it may be silently dropped.
export const ARC_MIN_GAS_PRICE_WEI = 20_000_000_000n;
export function boundedArcGasPrice(price: bigint) {
  if (price < 0n) throw new Error("Invalid gas price");
  const buffered = price * 2n;
  return buffered < ARC_MIN_GAS_PRICE_WEI ? ARC_MIN_GAS_PRICE_WEI : buffered;
}
