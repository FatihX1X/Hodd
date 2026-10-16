import { describe, expect, it } from "vitest";
import { consumedNonceProof, minedWithNonce, type NonceReader } from "./nonce-proof";

const owner = "0xdef09d06764ee3ca611ce186f47dbd3f546d2e7c";
const usdc = "0x3600000000000000000000000000000000000000";
const payment = { to: usdc, data: "0xa9059cbb0000000000000000000000003406584ccd8cc2fa38bfd3ece96d5dd4371b004000000000000000000000000000000000000000000000000000000000001e8480" };
/** A chain where the owner's nonce 62 is used at block `minedAt` by `tx`. */
function chain(minedAt: bigint | null, tx: { to: string; input: string } = { to: usdc, input: "0xa9059cbb" }): NonceReader & { reads: number } {
  const reader = {
    reads: 0,
    getBlockNumber: async () => 1_000n,
    getTransactionCount: async ({ blockNumber }: { blockNumber: bigint }) => { reader.reads += 1; return minedAt !== null && blockNumber >= minedAt ? 63 : 62; },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ transactions: blockNumber === minedAt ? [{ hash: "0x" + "c".repeat(64) as `0x${string}`, from: owner, to: tx.to, input: tx.input as `0x${string}`, nonce: 62 }] : [] }),
  };
  return reader;
}

describe("consumed nonce proof", () => {
  it("finds the block that used the nonce with a binary search, not a scan", async () => {
    const reader = chain(777n);
    expect(await minedWithNonce(reader, owner, 62n, 100n)).toMatchObject({ hash: "0x" + "c".repeat(64), blockNumber: 777n });
    expect(reader.reads).toBeLessThan(15);
  });
  it("proves a payment can never land when a different transaction used its nonce", async () => {
    expect(await consumedNonceProof(chain(777n), owner, 62n, 100n, payment)).toEqual({ proof: { kind: "EOA_NONCE_CONSUMED", nonce: "62", txHash: "0x" + "c".repeat(64), blockNumber: "777" } });
  });
  it("points at the payment itself when the mined transaction is the payment", async () => {
    expect(await consumedNonceProof(chain(777n, { to: usdc, input: payment.data }), owner, 62n, 100n, payment)).toEqual({ payment: "0x" + "c".repeat(64) });
  });
  it("proves nothing while the nonce is unused, or when it was used before the payment existed", async () => {
    expect(await consumedNonceProof(chain(null), owner, 62n, 100n, payment)).toBeNull();
    expect(await consumedNonceProof(chain(50n), owner, 62n, 100n, payment)).toBeNull();
  });
});
