// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("./circle", () => ({ agentAdapter: vi.fn() }));
vi.mock("@/lib/earn/gateway", () => ({ earnKit: {}, operationConfig: () => undefined }));
import { roundedWithdrawal } from "./quotes";

describe("roundedWithdrawal", () => {
  it("re-quotes a rounding gap at the provider's exact max", () => {
    expect(roundedWithdrawal(7_969_330n, 7_969_328n)).toBe(7_969_328n); // observed live, 2026-10-10
    expect(roundedWithdrawal(1_000n, 901n)).toBe(901n); // 100-unit floor for small positions
  });
  it("leaves equal or larger maxima alone and refuses a real shortfall", () => {
    expect(roundedWithdrawal(7_969_330n, 7_969_330n)).toBeNull();
    expect(roundedWithdrawal(7_969_330n, 8_000_000n)).toBeNull();
    expect(roundedWithdrawal(7_969_330n, 7_900_000n)).toBeNull();
    expect(roundedWithdrawal(1_000n, 0n)).toBeNull();
  });
});
