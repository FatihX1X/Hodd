import { describe, expect, it } from "vitest";
import { boundedArcGasPrice, bufferedEarnGasLimit } from "./gas";
describe("Arc gas ceiling", () => {
  it("never submits below the 20 Gwei floor", () => { expect(boundedArcGasPrice(1n)).toBe(20_000_000_000n); expect(boundedArcGasPrice(15_000_000_000n)).toBe(30_000_000_000n); });
  it("rejects invalid RPC gas values", () => { expect(() => boundedArcGasPrice(-1n)).toThrow(); });
  it("reserves a rounded-up 20 percent gas margin using integer units", () => {
    expect(bufferedEarnGasLimit(52000n)).toBe(62400n);
    expect(bufferedEarnGasLimit(1n)).toBe(2n);
    expect(() => bufferedEarnGasLimit(0n)).toThrow();
  });
});
