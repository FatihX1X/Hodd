// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from "jose";
vi.mock("server-only", () => ({}));
import { verifyAgentToken, agentIdentity } from "./auth";

const issuer = "https://example.supabase.co/auth/v1";
const user = "11111111-2222-4333-8444-555555555555";

async function setup() {
  const { privateKey, publicKey } = await generateKeyPair("ES256");
  const jwk = { ...(await exportJWK(publicKey)), kid: "test", alg: "ES256" };
  const keys = createLocalJWKSet({ keys: [jwk] });
  const token = (claims: Record<string, unknown>, options: { iss?: string; aud?: string; exp?: string } = {}) => new SignJWT({ role: "authenticated", ...claims })
    .setProtectedHeader({ alg: "ES256", kid: "test" }).setSubject(user).setIssuer(options.iss ?? issuer).setAudience(options.aud ?? "authenticated").setIssuedAt().setExpirationTime(options.exp ?? "1h").sign(privateKey);
  return { keys, token };
}

describe("connector token verification", () => {
  it("accepts a Supabase OAuth token issued to a connector client", async () => {
    const { keys, token } = await setup();
    const jwt = await token({ client_id: "claude-client", session_id: "s1", scope: "openid email" });
    const info = await verifyAgentToken(jwt, { issuer, keys });
    expect(info).toMatchObject({ clientId: "claude-client", scopes: ["openid", "email"] });
    expect(agentIdentity(info)).toEqual({ userId: user, clientId: "claude-client", sessionId: "s1" });
  });
  it("rejects browser session tokens (no client_id), anonymous users and foreign or expired tokens", async () => {
    const { keys, token } = await setup();
    expect(await verifyAgentToken(await token({}), { issuer, keys })).toBeUndefined();
    expect(await verifyAgentToken(await token({ client_id: "c", is_anonymous: true }), { issuer, keys })).toBeUndefined();
    expect(await verifyAgentToken(await token({ client_id: "c" }, { iss: "https://evil.example/auth/v1" }), { issuer, keys })).toBeUndefined();
    expect(await verifyAgentToken(await token({ client_id: "c" }, { aud: "other" }), { issuer, keys })).toBeUndefined();
    expect(await verifyAgentToken(await token({ client_id: "c" }, { exp: "-1m" }), { issuer, keys })).toBeUndefined();
    expect(await verifyAgentToken(undefined, { issuer, keys })).toBeUndefined();
    const other = await setup();
    expect(await verifyAgentToken(await other.token({ client_id: "c" }), { issuer, keys })).toBeUndefined();
  });
  it("refuses tools without a verified identity", () => {
    expect(() => agentIdentity(undefined)).toThrow("Connect Hodd again");
  });
});
