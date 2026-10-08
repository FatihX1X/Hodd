import "server-only";
import { createHash, createHmac, hkdfSync, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AgentError } from "./auth";

/**
 * Prepare → confirm handles. A prepare tool changes nothing and returns this
 * signed, short-lived handle; the matching write tool must repeat the exact same
 * change, made by the same user and connector client, against the same workspace
 * revision. The handle id becomes the agent_actions primary key, so it works once.
 */
export const HANDLE_TTL_MS = 10 * 60_000;
const payloadSchema = z.object({
  v: z.literal(1), id: z.string().uuid(), uid: z.string(), cid: z.string(), scope: z.enum(["TREASURY", "SMOKE_TEST"]),
  kind: z.string(), digest: z.string().regex(/^[\da-f]{64}$/), rev: z.number().int().nonnegative(), exp: z.number().int(),
}).strict();
export type HandlePayload = z.infer<typeof payloadSchema>;

/**
 * Prefer a dedicated HODD_MCP_HANDLE_SECRET. Otherwise derive a separate key with
 * HKDF from an existing server-only secret (domain-separated by the label), so
 * the connector works without one more host variable. Never a public value.
 */
export function handleSecret(env: Record<string, string | undefined> = process.env): Buffer | string {
  const dedicated = env.HODD_MCP_HANDLE_SECRET?.trim();
  if (dedicated) {
    if (dedicated.length < 32) throw new AgentError("UNCONFIGURED", "The connector confirmation secret is too short.");
    return dedicated;
  }
  const root = [env.SUPABASE_SECRET_KEY, env.CIRCLE_API_KEY].map((value) => value?.trim()).find((value) => value && value.length >= 32);
  if (!root) throw new AgentError("UNCONFIGURED", "The connector confirmation secret is not configured.");
  return Buffer.from(hkdfSync("sha256", root, "hodd", "hodd-mcp-confirmation-v1", 32));
}
type Key = Buffer | string;
let databaseKey: string | null = null;

/**
 * Key for this request: host configuration first, otherwise the random key the
 * database generated (hodd_agent_confirmation_key, connector tokens only).
 */
export async function confirmationKey(client: { rpc: (name: string) => PromiseLike<{ data: unknown; error: unknown }> }): Promise<Key> {
  try { return handleSecret(); }
  catch (error) { if (!(error instanceof AgentError) || !error.message.includes("not configured")) throw error; }
  if (databaseKey) return databaseKey;
  const { data, error } = await client.rpc("hodd_agent_confirmation_key");
  if (error || typeof data !== "string" || data.length < 32) throw new AgentError("UNCONFIGURED", "The connector confirmation key is unavailable.");
  databaseKey = data;
  return data;
}

/** Order-independent digest of a JSON change, so equal changes always match. */
export function changeDigest(value: unknown) {
  const canonical = (item: unknown): unknown => Array.isArray(item) ? item.map(canonical) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item as Record<string, unknown>).filter(([, inner]) => inner !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, inner]) => [key, canonical(inner)])) : item;
  return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
}

const sign = (body: string, key: Key) => createHmac("sha256", key).update(body).digest("base64url");

export function issueHandle(input: Omit<HandlePayload, "v" | "id" | "exp" | "digest"> & { change: unknown }, now = Date.now(), key: Key = handleSecret()) {
  const payload: HandlePayload = { v: 1, id: randomUUID(), uid: input.uid, cid: input.cid, scope: input.scope, kind: input.kind, digest: changeDigest(input.change), rev: input.rev, exp: now + HANDLE_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { handle: `${body}.${sign(body, key)}`, payload };
}

export function verifyHandle(handle: string, expected: { uid: string; cid: string; scope: string; kind: string; change: unknown }, now = Date.now(), key: Key = handleSecret()): HandlePayload {
  const fail = (message: string): never => { throw new AgentError("CONFIRMATION_INVALID", message); };
  const [body, mac, extra] = handle.split(".");
  if (!body || !mac || extra !== undefined) fail("The confirmation handle is malformed. Prepare the change again.");
  const actual = Buffer.from(mac); const wanted = Buffer.from(sign(body, key));
  if (actual.length !== wanted.length || !timingSafeEqual(actual, wanted)) fail("The confirmation handle is not valid. Prepare the change again.");
  let payload: HandlePayload;
  try { payload = payloadSchema.parse(JSON.parse(Buffer.from(body, "base64url").toString("utf8"))); }
  catch { return fail("The confirmation handle is malformed. Prepare the change again."); }
  if (payload.exp <= now) fail("The confirmation expired (10 minutes). Prepare the change again.");
  if (payload.uid !== expected.uid || payload.cid !== expected.cid) fail("This confirmation belongs to another user or connection.");
  if (payload.scope !== expected.scope || payload.kind !== expected.kind || payload.digest !== changeDigest(expected.change)) fail("The values differ from the prepared change. Prepare the change again with these values.");
  return payload;
}
