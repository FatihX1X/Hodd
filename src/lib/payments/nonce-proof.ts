import { getAddress, type Hex } from "viem";

/** The reads this needs; the Arc client provides them (historical nonces included). */
export interface NonceReader {
  getBlockNumber(): Promise<bigint>;
  getTransactionCount(args: { address: `0x${string}`; blockNumber: bigint }): Promise<number>;
  getBlock(args: { blockNumber: bigint; includeTransactions: true }): Promise<{ transactions: readonly { hash: Hex; from: string; to: string | null; input: Hex; nonce: number }[] }>;
}

/** Public Arc RPCs rate-limit bursts; the search reads one nonce at a time and backs off a little on a refusal. */
async function retry<T>(read: () => Promise<T>, attempts = 4): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try { return await read(); }
    catch (error) { if (attempt >= attempts) throw error; await new Promise((resolve) => setTimeout(resolve, 400 * attempt)); }
  }
}

/**
 * The mined transaction that used `nonce` for `address`, found by a binary search over historical nonces from
 * `fromBlock` (the payment's start block) to the chain head. Null when the nonce is still unused there.
 */
export async function minedWithNonce(client: NonceReader, address: string, nonce: bigint, fromBlock: bigint) {
  const account = getAddress(address);
  const count = (blockNumber: bigint) => retry(async () => BigInt(await client.getTransactionCount({ address: account, blockNumber })));
  let high = await client.getBlockNumber();
  if (await count(high) <= nonce) return null;
  let low = fromBlock;
  if (await count(low) > nonce) return null; // already used before the payment existed: not this payment's nonce
  while (low + 1n < high) { const mid = (low + high) / 2n; if (await count(mid) > nonce) high = mid; else low = mid; }
  const block = await retry(() => client.getBlock({ blockNumber: high, includeTransactions: true }));
  const tx = block.transactions.find((item) => getAddress(item.from) === account && BigInt(item.nonce) === nonce);
  return tx ? { hash: tx.hash, to: tx.to ? getAddress(tx.to) : null, input: tx.input.toLowerCase() as Hex, blockNumber: high } : null;
}

/**
 * Proof that a payment an EOA never reported can no longer happen: the nonce it was prepared with was used by a
 * different transaction that is already mined, so no signed copy of the payment can ever be included. Null when the
 * nonce is unused, or when the mined transaction is the payment itself (then its receipt must be verified instead).
 */
export async function consumedNonceProof(client: NonceReader, address: string, nonce: bigint, fromBlock: bigint, payment: { to: string; data: string }) {
  const used = await minedWithNonce(client, address, nonce, fromBlock);
  if (!used) return null;
  if (used.to && used.to === getAddress(payment.to) && used.input === payment.data.toLowerCase()) return { payment: used.hash };
  return { proof: { kind: "EOA_NONCE_CONSUMED", nonce: nonce.toString(), txHash: used.hash, blockNumber: used.blockNumber.toString() } };
}
