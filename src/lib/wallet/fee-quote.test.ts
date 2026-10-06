import { describe, expect, it } from "vitest";
import { assertFeeBinding, decimalToIntegerCeil, walletFeeQuoteSchema } from "./fee-quote";
const quote = { provider: "INJECTED_RABBY", source: "ARC_EOA", walletAddress: "0x0000000000000000000000000000000000000001", chainId: 5042002, operationDigest: "transfer", observedAt: "2026-10-06T00:00:00Z", expiresAt: "2026-10-06T00:05:00Z", sponsorship: "NOT_ASSUMED", gasLimit: "21000", maxFeePerGasWei: "20000000001", priorityFeePerGasWei: "0", maxNativeFeeWei: "420000000021000", maxWalletDebit: { currency: "USDC", decimals: 6, minorUnits: "421" } };
describe("provider-bound fee ceiling", () => {
  it("rounds decimal fees upward without floating point", () => {
    expect(decimalToIntegerCeil("20.0000000001", 9)).toBe(20000000001n);
    expect(decimalToIntegerCeil("0.0000000000000000001", 18)).toBe(1n);
    expect(decimalToIntegerCeil("12345678901234567890.000000001", 9)).toBe(12345678901234567890000000001n);
    for (const invalid of ["1e-9", "NaN", "-1", "1,2", ""]) expect(() => decimalToIntegerCeil(invalid, 9)).toThrow();
  });
  it("rejects a fake sponsorship, understated debit, inconsistent cap or provider", () => {
    expect(walletFeeQuoteSchema.safeParse(quote).success).toBe(true);
    for (const change of [{ sponsorship: "VERIFIED" }, { maxNativeFeeWei: "1" }, { provider: "CIRCLE_MODULAR" }, { priorityFeePerGasWei: "20000000002" }, { expiresAt: "2026-10-06T00:06:00Z" }, { maxWalletDebit: { ...quote.maxWalletDebit, minorUnits: "420" } }]) expect(walletFeeQuoteSchema.safeParse({ ...quote, ...change }).success).toBe(false);
  });
  it("binds operation, wallet, provider, network and five-minute expiry", () => {
    const value = walletFeeQuoteSchema.parse(quote); const binding = { provider: value.provider, address: value.walletAddress, digest: "transfer" };
    expect(assertFeeBinding(value, binding, Date.parse(value.observedAt))).toEqual(value);
    expect(() => assertFeeBinding(value, binding, Date.parse(value.expiresAt))).toThrow();
    for (const changed of [{ ...binding, digest: "different" }, { ...binding, provider: "CIRCLE_USER_CONTROLLED" }, { ...binding, address: "0x0000000000000000000000000000000000000002" }]) expect(() => assertFeeBinding(value, changed, Date.parse(value.observedAt))).toThrow();
  });
});
