import { describe, expect, it } from "vitest";
import { decimalStringToMoney } from "./money";
import { evaluateEarnQuotePolicy } from "./policy";

describe("Earn quote policy", () => {
  it("blocks a deposit whose amount plus reserve exceeds deployable cap", () => {
    expect(evaluateEarnQuotePolicy("DEPOSIT", decimalStringToMoney("9.95"), [decimalStringToMoney("0.10")], decimalStringToMoney("10"), [])).toMatchObject({ status: "BLOCKED" });
  });

  it("allows withdrawals up to redeemable liquidity regardless of allocation cap", () => {
    expect(evaluateEarnQuotePolicy("WITHDRAW", decimalStringToMoney("5"), [], decimalStringToMoney("5"), [])).toMatchObject({ status: "PASS" });
    expect(evaluateEarnQuotePolicy("REDEEM_ALL", decimalStringToMoney("5.000001"), [], decimalStringToMoney("5"), [])).toMatchObject({ status: "BLOCKED" });
  });

  it("requires review when the live quote has warnings", () => {
    expect(evaluateEarnQuotePolicy("DEPOSIT", decimalStringToMoney("1"), [], decimalStringToMoney("2"), ["Low liquidity"])).toMatchObject({ status: "REVIEW" });
  });
});
