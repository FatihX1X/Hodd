import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { earnQuoteSchema, type EarnQuote } from "./models";
import { z } from "zod";

const recordSchema = z.object({ quote: earnQuoteSchema, binding: z.string(), policyDigest: z.string() });
export type BoundQuote = z.infer<typeof recordSchema>;
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Atomic filesystem leases are appropriate only for the enforced local-development scope. */
export class DurableEarnQuotes {
  constructor(private readonly directory: string) {}
  private path(id: string, suffix: string) {
    if (!z.string().uuid().safeParse(id).success) throw new Error("QUOTE_NOT_AVAILABLE");
    return join(/* turbopackIgnore: true */ this.directory, `${id}.${suffix}`);
  }
  async put(value: BoundQuote) {
    const record = recordSchema.parse(value);
    if (!record.quote.quoteId || record.quote.policy.status === "BLOCKED") throw new Error("QUOTE_NOT_EXECUTABLE");
    await mkdir(this.directory, { recursive: true });
    await writeFile(this.path(record.quote.quoteId, "json"), JSON.stringify(record), { flag: "wx", mode: 0o600 });
  }
  async read(id: string, binding: string, now = new Date()): Promise<BoundQuote> {
    let record: BoundQuote;
    try { record = recordSchema.parse(JSON.parse(await readFile(this.path(id, "json"), "utf8"))); }
    catch { throw new Error("QUOTE_NOT_AVAILABLE"); }
    if (record.binding !== binding) throw new Error("QUOTE_NOT_AVAILABLE");
    if (!record.quote.expiresAt || Date.parse(record.quote.expiresAt) <= now.getTime()) throw new Error("QUOTE_EXPIRED");
    return record;
  }
  async consume(id: string, binding: string, warningsAcknowledged: boolean, now = new Date()): Promise<BoundQuote> {
    const record = await this.read(id, binding, now);
    if (record.quote.requiresWarningAcknowledgement && !warningsAcknowledged) throw new Error("WARNINGS_NOT_ACKNOWLEDGED");
    try { await writeFile(this.path(id, "consumed"), "consumed", { flag: "wx", mode: 0o600 }); }
    catch { throw new Error("QUOTE_NOT_AVAILABLE"); }
    return record;
  }
}

export const durableEarnQuotes = new DurableEarnQuotes(join(process.cwd(), ".hodd-local", "quotes"));
export function executableQuote(quote: EarnQuote) { return quote.quoteId !== null && quote.policy.status !== "BLOCKED"; }
