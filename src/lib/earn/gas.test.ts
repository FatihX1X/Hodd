import { describe, expect, it } from "vitest";
import { boundedArcGasPrice } from "./gas";
describe("Arc gas ceiling", () => {
  it("never submits below the 20 Gwei floor", () => { expect(boundedArcGasPrice(1n)).toBe(20_000_000_000n); expect(boundedArcGasPrice(15_000_000_000n)).toBe(30_000_000_000n); });
  it("rejects invalid RPC gas values", () => { expect(() => boundedArcGasPrice(-1n)).toThrow(); });
});
