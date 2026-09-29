import { describe, expect, it } from "vitest";
import { addUsdc, decimalStringToMoney, minUsdc, nativeWeiToUsdcCeil } from "./money";

describe("Earn money arithmetic", () => {
  it("converts decimal strings exactly without floating point", () => {
    expect(decimalStringToMoney("1.000001")).toEqual({ currency: "USDC", decimals: 6, minorUnits: "1000001" });
    expect(decimalStringToMoney("0.000001").minorUnits).toBe("1");
    expect(() => decimalStringToMoney("1.0000001")).toThrow(/6 decimal/i);
  });

  it("rounds native gas upward into six-decimal USDC reserve units", () => {
    expect(nativeWeiToUsdcCeil("1").minorUnits).toBe("1");
    expect(nativeWeiToUsdcCeil("1000000000000").minorUnits).toBe("1");
    expect(nativeWeiToUsdcCeil("1000000000001").minorUnits).toBe("2");
  });

  it("adds and selects minimum values as bigint minor units", () => {
    expect(addUsdc([decimalStringToMoney("1.20"), decimalStringToMoney("0.30")]).minorUnits).toBe("1500000");
    expect(minUsdc(decimalStringToMoney("2"), decimalStringToMoney("1.5"), decimalStringToMoney("4")).minorUnits).toBe("1500000");
  });
});
