import "server-only";
import { createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { z } from "zod";
import { handleSecret, changeDigest } from "@/lib/agent/handles";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { treasuryWorkspaceSchema } from "@/lib/treasury/models";
import { HoddieError, routingSchema, type HoddieProvider, type HoddieRouting } from "./models";

export const CONSENT_COOKIE = "hoddie-consent";
export const TTL_MS = 10 * 60_000;
const consentSchema = z.object({ type: z.literal("CONSENT"), uid: z.string(), sid: z.string(), provider: routingSchema, nonce: z.string().uuid(), exp: z.number() }).strict();
const envelopeSchema = z.object({ type: z.enum(["PROPOSAL", "SELECTION", "REFERENCE"]), id: z.string().uuid(), uid: z.string(), sid: z.string(), provider: routingSchema, nonce: z.string(), revision: z.number().int(), wallet: z.string(), exp: z.number(), data: z.record(z.string(), z.unknown()) }).strict();
type Envelope = z.infer<typeof envelopeSchema>;
function key() { return hkdfSync("sha256", handleSecret(), "hodd", "hoddie-first-party-v1", 32); }
export function seal(value: unknown): string {
  const body = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${body}.${createHmac("sha256", Buffer.from(key())).update(body).digest("base64url")}`;
}
export function open<T>(value: string, schema: z.ZodType<T>): T {
  try {
    const [body, mac, extra] = value.split("."); if (!body || !mac || extra) throw new Error();
    const expected = Buffer.from(createHmac("sha256", Buffer.from(key())).update(body).digest("base64url")); const actual = Buffer.from(mac);
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error();
    return schema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8")));
  } catch { throw new HoddieError("INVALID_CONFIRMATION", "This review is invalid or unavailable. Prepare it again.", 409); }
}

export function sameOrigin(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new HoddieError("ORIGIN_REJECTED", "Open Hoddie from this Hodd application.", 403);
}

export async function hoddieContext() {
  const client = await createSupabaseServerClient();
  if (!client) throw new HoddieError("AUTH_REQUIRED", "Sign in to use your treasury with Hoddie.", 401);
  const [{ data: user, error }, { data: claims }, { data: active, error: activeError }] = await Promise.all([client.auth.getUser(), client.auth.getClaims(), client.rpc("hodd_earn_session_active")]);
  const sid = claims?.claims.session_id;
  if (error || !user.user || user.user.is_anonymous || typeof sid !== "string" || claims?.claims.client_id || activeError || active !== true) throw new HoddieError("AUTH_REQUIRED", "Your Hodd session expired. Sign in again.", 401);
  const { data: row, error: readError } = await client.from("treasury_workspaces").select("workspace,revision").eq("user_id", user.user.id).maybeSingle();
  const parsed = treasuryWorkspaceSchema.safeParse(row?.workspace);
  if (readError || !parsed.success) throw new HoddieError("WORKSPACE_REQUIRED", "Open Portfolio and sync your main workspace before using Hoddie.", 409);
  return { client, userId: user.user.id, sessionId: sid, workspace: parsed.data, revision: Number(row!.revision), wallet: changeDigest(parsed.data.walletConnection) };
}
export type HoddieContext = Awaited<ReturnType<typeof hoddieContext>>;
export async function requireConsent(context: HoddieContext, provider: HoddieRouting) {
  const value = (await cookies()).get(CONSENT_COOKIE)?.value;
  if (!value) throw new HoddieError("CONSENT_REQUIRED", "Allow command interpretation for this provider first.", 403);
  const consent = open(value, consentSchema);
  if (consent.uid !== context.userId || consent.sid !== context.sessionId || consent.provider !== provider || consent.exp <= Date.now()) throw new HoddieError("CONSENT_REQUIRED", "Allow command interpretation for this provider again.", 403);
  return consent;
}
export function newConsent(context: HoddieContext, provider: HoddieRouting) {
  return seal({ type: "CONSENT", uid: context.userId, sid: context.sessionId, provider, nonce: randomUUID(), exp: Date.now() + 3_600_000 });
}
export function issueReview(context: HoddieContext, consent: Awaited<ReturnType<typeof requireConsent>>, type: Envelope["type"], data: Envelope["data"], now = Date.now()) {
  const payload: Envelope = { type, id: randomUUID(), uid: context.userId, sid: context.sessionId, provider: consent.provider, nonce: consent.nonce, revision: context.revision, wallet: context.wallet, exp: now + TTL_MS, data };
  return { handle: seal(payload), payload };
}
export function verifyReview(value: string, context: HoddieContext, consent: Awaited<ReturnType<typeof requireConsent>>, type: Envelope["type"], now = Date.now()) {
  const payload = open(value, envelopeSchema);
  if (payload.type !== type || payload.uid !== context.userId || payload.sid !== context.sessionId || payload.provider !== consent.provider || payload.nonce !== consent.nonce || payload.exp <= now || payload.wallet !== context.wallet || payload.revision !== context.revision) throw new HoddieError("REVIEW_CHANGED", "The session, wallet or workspace changed, or this review expired. Prepare it again.", 409);
  return payload;
}
export async function reserveUsage(context: HoddieContext, provider: HoddieProvider, modelCall: boolean) {
  const { error } = await context.client.rpc("hoddie_reserve_usage", { p_provider: provider, p_model_call: modelCall });
  if (error) throw new HoddieError("RATE_LIMIT", "Hoddie reached its request limit or the usage service is unavailable. No additional model call will be sent; try later.", 429);
}
