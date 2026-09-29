import { describe, expect, it } from "vitest";
import { EarnQuoteStore } from "./quote-store";
import type { EarnQuote } from "./models";

function quote(overrides: Partial<EarnQuote> = {}): EarnQuote {
  return {
    quoteId: "00000000-0000-4000-8000-000000000001",
    operation: "DEPOSIT",
    walletAddress: "0x0000000000000000000000000000000000000001",
    vaultAddress: "0x0000000000000000000000000000000000000002",
    vaultName: "Vault",
    amount: { currency: "USDC", decimals: 6, minorUnits: "1000000" },
    expectedShares: "1",
    sharesToRedeem: null,
    maxWithdrawable: null,
    fees: { currency: "USDC", decimals: 6, minorUnits: "1" },
    gasFees: [], warnings: [],
    policy: { status: "PASS", label: "Earn policy", reason: "Within limit" },
    expiresAt: "2026-09-28T12:05:00.000Z",
    requiresWarningAcknowledgement: false,
    ...overrides,
  };
}

describe("EarnQuoteStore", () => {
  it("consumes a quote only once", () => { const store = new EarnQuoteStore(); store.put({ quote: quote() }); expect(store.take(quote().quoteId!, false, new Date("2026-09-28T12:00:00.000Z"))).toBeTruthy(); expect(() => store.take(quote().quoteId!, false, new Date("2026-09-28T12:00:01.000Z"))).toThrow("QUOTE_NOT_AVAILABLE"); });
  it("rejects expired quotes", () => { const store = new EarnQuoteStore(); store.put({ quote: quote() }); expect(() => store.take(quote().quoteId!, false, new Date("2026-09-28T12:05:00.000Z"))).toThrow(); });
  it("does not consume a warning quote until acknowledgement", () => { const store = new EarnQuoteStore(); store.put({ quote: quote({ warnings: ["Review"], requiresWarningAcknowledgement: true }) }); expect(() => store.take(quote().quoteId!, false, new Date("2026-09-28T12:00:00.000Z"))).toThrow("WARNINGS_NOT_ACKNOWLEDGED"); expect(store.take(quote().quoteId!, true, new Date("2026-09-28T12:00:01.000Z"))).toBeTruthy(); });
});
