import "server-only";
import { z } from "zod";
import { GATEWAY_API_TESTNET } from "./chains";
import { assertSameSpec, burnIntentSchema, type BurnIntent, type TransferSpec } from "./intent";

// Circle Gateway REST API (testnet). No automatic retries: a lost transfer
// response is reconciled from Gateway status and Arc receipts, never resent.
export class GatewayApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 503, public readonly definitive = false) { super(message); }
}

const TIMEOUT_MS = 12_000;
async function call(path: string, init?: { body: unknown }) {
  let response: Response;
  try {
    response = await fetch(`${GATEWAY_API_TESTNET}${path}`, { method: init ? "POST" : "GET", headers: init ? { "Content-Type": "application/json" } : undefined, body: init ? JSON.stringify(init.body) : undefined, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch { throw new GatewayApiError("GATEWAY_UNREACHABLE", "Circle Gateway did not answer. Nothing new was sent; check the status again shortly."); }
  const body: unknown = await response.json().catch(() => null);
  // A 4xx with an error body is a definitive refusal: Gateway did not accept the request.
  if (!response.ok || (body && typeof body === "object" && "success" in body && body.success === false)) {
    const message = body && typeof body === "object" && "message" in body && typeof body.message === "string" ? body.message.slice(0, 200) : `HTTP ${response.status}`;
    throw new GatewayApiError(/insufficient/i.test(message) ? "GATEWAY_BALANCE_INSUFFICIENT" : "GATEWAY_REJECTED", `Circle Gateway refused the request: ${message}`, response.status >= 500 ? 503 : 409, response.status >= 400 && response.status < 500);
  }
  return body;
}

const decimal = z.string().regex(/^\d+(\.\d+)?$/);
const balancesSchema = z.object({ token: z.literal("USDC"), balances: z.array(z.object({ domain: z.number().int(), depositor: z.string(), balance: decimal })) });

/** Confirmed Gateway (unified) balance per domain, in 6-decimal minor units. */
export async function gatewayBalances(depositor: string) {
  const parsed = balancesSchema.safeParse(await call("/v1/balances", { body: { token: "USDC", sources: [{ depositor }] } }));
  if (!parsed.success) throw new GatewayApiError("GATEWAY_RESPONSE_INVALID", "Circle Gateway returned an unexpected balance response.");
  return new Map(parsed.data.balances.map((item) => [item.domain, decimalToMinor(item.balance)]));
}

export function decimalToMinor(value: string) {
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > 6) throw new GatewayApiError("GATEWAY_RESPONSE_INVALID", "Circle Gateway returned more than 6 decimals.");
  return BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
}

const estimateIntentSchema = z.object({ maxBlockHeight: z.string().regex(/^\d+$/), maxFee: z.string().regex(/^\d+$/), spec: z.record(z.string(), z.unknown()) });
const estimateSchema = z.object({
  body: z.array(z.object({ burnIntent: estimateIntentSchema.optional(), burnIntentSet: z.object({ intents: z.array(estimateIntentSchema) }).optional() })).length(1),
  fees: z.object({ total: decimal, forwardingFee: decimal.optional() }),
});

/** Forwarded estimate: Gateway fills the expiry and fee cap; the spec must come back unchanged. */
export async function estimateForwardedTransfer(spec: TransferSpec): Promise<{ intent: BurnIntent; feeMinor: bigint; forwardingFeeMinor: bigint }> {
  const parsed = estimateSchema.safeParse(await call("/v1/estimate?enableForwarder=true", { body: [{ spec }] }));
  const entry = parsed.success ? parsed.data.body[0].burnIntent ?? (parsed.data.body[0].burnIntentSet?.intents.length === 1 ? parsed.data.body[0].burnIntentSet.intents[0] : undefined) : undefined;
  if (!parsed.success || !entry) throw new GatewayApiError("GATEWAY_RESPONSE_INVALID", "Circle Gateway returned an unexpected estimate.");
  try { assertSameSpec(entry.spec, spec); }
  catch { throw new GatewayApiError("GATEWAY_ESTIMATE_MISMATCH", "Circle Gateway changed the transfer details in its estimate. Nothing was signed."); }
  const intent = burnIntentSchema.parse({ maxBlockHeight: entry.maxBlockHeight, maxFee: entry.maxFee, spec });
  return { intent, feeMinor: BigInt(intent.maxFee), forwardingFeeMinor: decimalToMinor(parsed.data.fees.forwardingFee ?? "0") };
}

/** Sends a signed intent with Circle's Forwarding Service (Circle submits the Arc mint). */
export async function submitForwardedTransfer(intent: BurnIntent, signature: `0x${string}`) {
  const parsed = z.object({ transferId: z.string().uuid() }).passthrough().safeParse(await call("/v1/transfer?enableForwarder=true", { body: [{ burnIntent: { maxBlockHeight: intent.maxBlockHeight, maxFee: intent.maxFee, spec: intent.spec }, signature }] }));
  if (!parsed.success) throw new GatewayApiError("GATEWAY_RESPONSE_INVALID", "Circle Gateway accepted the transfer without an id. Check the status before doing anything else.");
  return parsed.data.transferId;
}

const statusSchema = z.object({
  status: z.enum(["pending", "confirmed", "finalized", "failed", "expired"]), destinationDomain: z.number().int().optional(),
  transactionHash: z.string().regex(/^0x[\da-fA-F]{64}$/).optional(),
  forwardingDetails: z.object({ forwardingEnabled: z.boolean(), failureReason: z.string().optional() }).optional(),
}).passthrough();
export type GatewayTransferStatus = z.infer<typeof statusSchema>;

export async function gatewayTransferStatus(transferId: string): Promise<GatewayTransferStatus> {
  if (!z.string().uuid().safeParse(transferId).success) throw new GatewayApiError("INVALID_TRANSFER_ID", "Invalid transfer id.", 400, true);
  const parsed = statusSchema.safeParse(await call(`/v1/transfer/${transferId}`));
  if (!parsed.success) throw new GatewayApiError("GATEWAY_RESPONSE_INVALID", "Circle Gateway returned an unexpected transfer status.");
  return parsed.data;
}
