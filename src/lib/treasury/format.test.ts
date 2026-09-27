import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatPercentFromBps } from "./format";

describe("treasury formatting", () => {
  it("formats USDC from six-decimal minor units without floating point arithmetic", () => {
    expect(formatMoney({ currency: "USDC", minorUnits: "10000000000", decimals: 6 })).toBe("10,000.00 USDC");
    expect(formatMoney({ currency: "USDC", minorUnits: "4500000000", decimals: 6 }, { compact: true })).toBe("4.5K USDC");
  });

  it("formats deterministic UTC dates", () => {
    expect(formatDate("2026-10-04T17:00:00.000Z")).toBe("Oct 4, 2026");
  });

  it("formats basis points as a percentage", () => {
    expect(formatPercentFromBps(412, 2)).toBe("4.12%");
    expect(formatPercentFromBps(22222)).toBe("222%");
  });
});
