import { describe, expect, it } from "vitest";
import { addMoney, MoneyMismatchError, parseMoneyInput, subtractMoneyFloor } from "./money";
import { usdc } from "./fixtures";

describe("money arithmetic", () => {
  it("parses six-decimal input without floating point", () => { expect(parseMoneyInput("12.345678").minorUnits).toBe("12345678"); expect(() => parseMoneyInput("1.0000001")).toThrow(/up to 6 decimals/); });
  it("adds exact minor units and floors subtraction at zero", () => { expect(addMoney(usdc("9007199254740993000000"), usdc("7")).minorUnits).toBe("9007199254740993000007"); expect(subtractMoneyFloor(usdc("5"), usdc("8")).minorUnits).toBe("0"); });
  it("rejects incompatible money", () => { expect(() => addMoney(usdc("1"), { currency: "USD", decimals: 6, minorUnits: "1" })).toThrow(MoneyMismatchError); });
});
