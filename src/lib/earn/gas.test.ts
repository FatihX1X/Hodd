import { describe, expect, it } from "vitest";
import { boundedArcGasPrice, bufferedEarnGasLimit, earnStepGasLimit, quotedSigningGasPrice } from "./gas";
describe("Arc gas ceiling", () => {
  it("never submits below the 20 Gwei floor", () => { expect(boundedArcGasPrice(1n)).toBe(20_000_000_000n); expect(boundedArcGasPrice(15_000_000_000n)).toBe(30_000_000_000n); });
  it("rejects invalid RPC gas values", () => { expect(() => boundedArcGasPrice(-1n)).toThrow(); });
  it("reserves a rounded-up 20 percent gas margin using integer units", () => {
    expect(bufferedEarnGasLimit(52000n)).toBe(62400n);
    expect(bufferedEarnGasLimit(1n)).toBe(2n);
    expect(() => bufferedEarnGasLimit(0n)).toThrow();
  });
});

describe("quoted signing gas price", () => {
  it("accepts a raw price rise within the buffered ceiling without double buffering", () => {
    // Live regression: quote 22.44 gwei -> ceiling 44.88; network 23.562 gwei at signing.
    expect(quotedSigningGasPrice(23_562_000_000n, 44_880_000_000n)).toBe(44_880_000_000n);
    expect(quotedSigningGasPrice(20_000_000_000n, 44_880_000_000n)).toBe(40_000_000_000n);
    expect(quotedSigningGasPrice(1n, 44_880_000_000n)).toBe(20_000_000_000n);
  });
  it("refuses a network price above the approved ceiling", () => {
    expect(() => quotedSigningGasPrice(44_880_000_001n, 44_880_000_000n)).toThrow("FEE_RESERVE_EXCEEDED");
  });
});

describe("Earn step gas limits", () => {
  it("floors a deposit Earn Kit could not simulate behind a pending approval", () => {
    // Live regression: quoted 264,859; fresh-wallet routed deposit estimated 446,538.
    expect(earnStepGasLimit("Deposit", 264_859n, true)).toBe(600_000n);
    expect(earnStepGasLimit("Deposit", 700_000n, true)).toBe(840_000n);
  });
  it("keeps simulated deposits and other steps on the reported estimate", () => {
    expect(earnStepGasLimit("Deposit", 264_859n, false)).toBe(bufferedEarnGasLimit(264_859n));
    expect(earnStepGasLimit("Approve", 52_000n, true)).toBe(62_400n);
  });
});
