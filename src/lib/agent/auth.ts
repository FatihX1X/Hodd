import "server-only";
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createClient } from "@supabase/supabase-js";
import { supabaseConfig } from "@/lib/supabase/config";

/** Supabase Auth issues the connector's OAuth 2.1 tokens (Supabase OAuth Server). */
export function supabaseIssuer() {
  const { url } = supabaseConfig();
  return url ? `${url.replace(/\/+$/, "")}/auth/v1` : null;
}

let remoteKeys: { issuer: string; keys: JWTVerifyGetKey } | null = null;
function issuerKeys(issuer: string) {
  if (remoteKeys?.issuer !== issuer) remoteKeys = { issuer, keys: createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`)) };
  return remoteKeys.keys;
}

export type AgentIdentity = Readonly<{ userId: string; clientId: string; sessionId: string | null }>;

/**
 * Accepts only Supabase OAuth access tokens issued to a connector client. Normal
 * browser session tokens have no client_id claim, so a stolen browser cookie
 * cannot be replayed against the MCP endpoint.
 */
export async function verifyAgentToken(token: string | undefined, options: { issuer?: string | null; keys?: JWTVerifyGetKey } = {}): Promise<AuthInfo | undefined> {
  const issuer = options.issuer === undefined ? supabaseIssuer() : options.issuer;
  if (!token || !issuer) return undefined;
  let payload;
  try { ({ payload } = await jwtVerify(token, options.keys ?? issuerKeys(issuer), { issuer, audience: "authenticated", algorithms: ["ES256", "RS256"] })); }
  catch { return undefined; }
  const userId = payload.sub; const clientId = payload.client_id; const sessionId = payload.session_id;
  if (typeof userId !== "string" || !/^[\da-f-]{36}$/i.test(userId) || typeof clientId !== "string" || !clientId || payload.is_anonymous === true) return undefined;
  const identity: AgentIdentity = { userId, clientId, sessionId: typeof sessionId === "string" ? sessionId : null };
  return { token, clientId, scopes: typeof payload.scope === "string" ? payload.scope.split(" ").filter(Boolean) : [], expiresAt: payload.exp, extra: { identity } };
}

export function agentIdentity(authInfo: AuthInfo | undefined): AgentIdentity {
  const identity = (authInfo?.extra as { identity?: AgentIdentity } | undefined)?.identity;
  if (!identity) throw new AgentError("AUTH_REQUIRED", "Connect Hodd again in Claude.");
  return identity;
}

/** Supabase client acting as the user: owner RLS and database triggers apply. */
export function agentSupabase(token: string) {
  const { url, publishableKey } = supabaseConfig();
  if (!url || !publishableKey) throw new AgentError("UNCONFIGURED", "Hodd is not configured on this server.");
  return createClient(url, publishableKey, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

/** A revoked sign-in must stop working before the token's natural expiry. */
export async function assertAgentSessionActive(token: string) {
  const { data, error } = await agentSupabase(token).auth.getUser(token);
  if (error || !data.user) throw new AgentError("AUTH_REQUIRED", "Your Hodd sign-in expired or was revoked. Reconnect Hodd in Claude.");
}

export class AgentError extends Error {
  constructor(public readonly code: string, message: string) { super(message); this.name = "AgentError"; }
}
