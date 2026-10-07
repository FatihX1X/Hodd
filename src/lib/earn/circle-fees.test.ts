// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertBoundedEarnFeeProvider, boundedCircleChallengeFee } from "./circle-fees";

describe("Circle SCA fee safety", () => {
  it("never replaces a hard ceiling with an unbounded SCA feeLevel", () => {
    expect(() => boundedCircleChallengeFee("SCA", 100000n, 20000000000n)).toThrow("requires feeLevel");
    expect(() => assertBoundedEarnFeeProvider({ provider: "CIRCLE_USER_CONTROLLED", accountType: "SCA" })).toThrow("Verified gas sponsorship");
  });
  it("retains supported absolute EOA fees and leaves other providers alone", () => {
    expect(boundedCircleChallengeFee("EOA", 100000n, 20000000000n)).toEqual({ type: "absolute", config: { gasLimit: "100000", maxFee: "20", priorityFee: "2" } });
    expect(() => assertBoundedEarnFeeProvider({ provider: "INJECTED_METAMASK", accountType: "EOA" })).not.toThrow();
    expect(() => assertBoundedEarnFeeProvider({ provider: "CIRCLE_MODULAR", accountType: "SCA" })).not.toThrow();
  });
});
