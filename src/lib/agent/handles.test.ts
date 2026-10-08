// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { changeDigest, handleSecret, issueHandle, verifyHandle, HANDLE_TTL_MS } from "./handles";

const base = { uid: "u1", cid: "claude", scope: "TREASURY" as const, kind: "UPDATE_POLICY" };
const change = { safetyBuffer: "500", strategyCapsBps: { MORPHO: 5000 } };
beforeEach(() => { vi.stubEnv("HODD_MCP_HANDLE_SECRET", "x".repeat(48)); });
afterEach(() => { vi.unstubAllEnvs(); });

describe("confirmation handles", () => {
  it("binds user, connection, scope, kind, exact values and revision", () => {
    const { handle, payload } = issueHandle({ ...base, rev: 7, change });
    expect(verifyHandle(handle, { ...base, change: { strategyCapsBps: { MORPHO: 5000 }, safetyBuffer: "500" } })).toMatchObject({ id: payload.id, rev: 7 });
    expect(() => verifyHandle(handle, { ...base, change: { ...change, safetyBuffer: "501" } })).toThrow("values differ");
    expect(() => verifyHandle(handle, { ...base, uid: "u2", change })).toThrow("another user");
    expect(() => verifyHandle(handle, { ...base, cid: "other", change })).toThrow("another user");
    expect(() => verifyHandle(handle, { ...base, scope: "SMOKE_TEST", change })).toThrow("values differ");
    expect(() => verifyHandle(handle, { ...base, kind: "SET_TARGETS", change })).toThrow("values differ");
  });
  it("rejects tampering, foreign secrets and expiry", () => {
    const { handle } = issueHandle({ ...base, rev: 1, change });
    const [body, mac] = handle.split(".");
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, "base64url").toString()), uid: "attacker" })).toString("base64url");
    expect(() => verifyHandle(`${forged}.${mac}`, { ...base, change })).toThrow("not valid");
    expect(() => verifyHandle(`${body}.${mac}.x`, { ...base, change })).toThrow("malformed");
    vi.stubEnv("HODD_MCP_HANDLE_SECRET", "y".repeat(48));
    expect(() => verifyHandle(handle, { ...base, change })).toThrow("not valid");
    vi.stubEnv("HODD_MCP_HANDLE_SECRET", "x".repeat(48));
    expect(() => verifyHandle(handle, { ...base, change }, Date.now() + HANDLE_TTL_MS + 1)).toThrow("expired");
  });
  it("needs a strong server secret, or derives a separate key from an existing server secret", () => {
    vi.stubEnv("HODD_MCP_HANDLE_SECRET", "short");
    expect(() => issueHandle({ ...base, rev: 1, change })).toThrow("too short");
    expect(() => handleSecret({})).toThrow("not configured");
    const derived = handleSecret({ SUPABASE_SECRET_KEY: "k".repeat(40) });
    expect(Buffer.isBuffer(derived) && derived.length === 32).toBe(true);
    expect(derived).not.toEqual(Buffer.from("k".repeat(40)));
    expect(handleSecret({ CIRCLE_API_KEY: "c".repeat(40) })).not.toEqual(derived);
    expect(handleSecret({ HODD_MCP_HANDLE_SECRET: "d".repeat(40), SUPABASE_SECRET_KEY: "k".repeat(40) })).toBe("d".repeat(40));
  });
  it("digests JSON independent of key order and undefined fields", () => {
    expect(changeDigest({ a: 1, b: { c: 2, d: [1, { e: 3, f: undefined }] } })).toBe(changeDigest({ b: { d: [1, { e: 3 }], c: 2 }, a: 1 }));
    expect(changeDigest({ a: 1 })).not.toBe(changeDigest({ a: 2 }));
  });
});
