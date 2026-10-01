// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { DurableEarnQuotes, type BoundQuote } from "./durable-quotes";
import { earnQuoteRequestSchema, earnExecuteRequestSchema } from "./models";
const directories: string[] = [];
afterEach(async () => { for (const directory of directories.splice(0)) await rm(directory, { recursive: true, force: true }); });
async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "hodd-quote-test-")); directories.push(directory);
  const store = new DurableEarnQuotes(directory); const id = randomUUID();
  const record: BoundQuote = { binding: "alice-session-wallet", policyDigest: "policy", quote: { quoteId: id, operation: "DEPOSIT", walletAddress: "0x0000000000000000000000000000000000000001", vaultAddress: "0x0000000000000000000000000000000000000002", vaultName: "Vault", amount: { currency: "USDC", decimals: 6, minorUnits: "1000000" }, fees: { currency: "USDC", decimals: 6, minorUnits: "1" }, expectedShares: "1", sharesToRedeem: null, maxWithdrawable: null, gasFees: [], warnings: [], policy: { status: "PASS", label: "Policy", reason: "Fresh" }, expiresAt: new Date(Date.now() + 300_000).toISOString(), requiresWarningAcknowledgement: false } };
  await store.put(record); return { directory, store, record, id };
}
describe("durable, owner-bound quote consumption", () => {
  it("allows only one parallel consumer across store instances", async () => {
    const { directory, store, id, record } = await setup();
    const results = await Promise.allSettled([store.consume(id, record.binding, false), new DurableEarnQuotes(directory).consume(id, record.binding, false)]);
    expect(results.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    await expect(new DurableEarnQuotes(directory).consume(id, record.binding, false)).rejects.toThrow("QUOTE_NOT_AVAILABLE");
  });
  it("rejects cross-user, reconnect and missing quote access without consuming", async () => {
    const { store, id, record } = await setup();
    for (const binding of ["bob-session-wallet", "alice-new-session-wallet", "alice-session-new-wallet"]) await expect(store.consume(id, binding, false)).rejects.toThrow("QUOTE_NOT_AVAILABLE");
    await expect(store.consume(id, record.binding, false)).resolves.toEqual(record);
    await expect(store.read("../../escape", record.binding)).rejects.toThrow("QUOTE_NOT_AVAILABLE");
  });
  it("expires at exactly five minutes", async () => {
    const { store, id, record } = await setup();
    await expect(store.consume(id, record.binding, false, new Date(record.quote.expiresAt!))).rejects.toThrow("QUOTE_EXPIRED");
  });
  it("requires warning acknowledgement before consumption", async () => {
    const { store, record } = await setup(); const id = randomUUID();
    await store.put({ ...record, quote: { ...record.quote, quoteId: id, warnings: ["Low liquidity"], requiresWarningAcknowledgement: true } });
    await expect(store.consume(id, record.binding, false)).rejects.toThrow("WARNINGS_NOT_ACKNOWLEDGED");
    await expect(store.consume(id, record.binding, true)).resolves.toBeTruthy();
  });
  it("rejects client limits, wallet overrides and execution payload tampering", () => {
    const request = { operation: "DEPOSIT", vaultAddress: "0x0000000000000000000000000000000000000002", amount: "1.000001" };
    expect(earnQuoteRequestSchema.safeParse(request).success).toBe(true);
    for (const extra of [{ policyLimit: { currency: "USDC", decimals: 6, minorUnits: "99999999999" } }, { walletAddress: request.vaultAddress }]) expect(earnQuoteRequestSchema.safeParse({ ...request, ...extra }).success).toBe(false);
    expect(earnQuoteRequestSchema.safeParse({ ...request, amount: "1.0000001" }).success).toBe(false);
    expect(earnExecuteRequestSchema.safeParse({ quoteId: randomUUID(), confirmed: true, warningsAcknowledged: false, amount: "999" }).success).toBe(false);
  });
});
