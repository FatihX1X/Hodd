import type { EarnQuote } from "./models";

export const QUOTE_TTL_MS = 5 * 60 * 1000;
export type StoredQuote = Readonly<{ quote: EarnQuote; rawGasFees?: readonly unknown[] }>;

export class EarnQuoteStore {
  private readonly entries = new Map<string, { value: StoredQuote; consumed: boolean }>();
  put(value: StoredQuote) { if (!value.quote.quoteId) throw new Error("Only executable quotes can be stored"); this.prune(); this.entries.set(value.quote.quoteId, { value, consumed: false }); }
  take(id: string, warningsAcknowledged: boolean, now = new Date()): StoredQuote {
    this.prune(now);
    const entry = this.entries.get(id);
    if (!entry || entry.consumed) throw new Error("QUOTE_NOT_AVAILABLE");
    if (!entry.value.quote.expiresAt || new Date(entry.value.quote.expiresAt) <= now) { this.entries.delete(id); throw new Error("QUOTE_EXPIRED"); }
    if (entry.value.quote.requiresWarningAcknowledgement && !warningsAcknowledged) throw new Error("WARNINGS_NOT_ACKNOWLEDGED");
    entry.consumed = true;
    return entry.value;
  }
  prune(now = new Date()) { for (const [id, entry] of this.entries) if (!entry.value.quote.expiresAt || new Date(entry.value.quote.expiresAt) <= now) this.entries.delete(id); }
}

export const earnQuoteStore = new EarnQuoteStore();

