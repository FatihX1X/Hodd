import { describe, expect, it } from "vitest";
import { evaluateEarnExecutionAccess, requestHostOrigin } from "./access-policy";

const safe = { nodeEnv: "development", enabled: "true", hostname: "localhost", requestOrigin: "http://localhost:3000", urlOrigin: "http://localhost:3000", contentType: "application/json" };
describe("Earn execution access policy", () => {
  it("allows an explicitly enabled same-origin loopback development request", () => { expect(evaluateEarnExecutionAccess(safe)).toEqual({ allowed: true }); });
  it("fails closed in production even when the flag is enabled", () => { expect(evaluateEarnExecutionAccess({ ...safe, nodeEnv: "production" })).toMatchObject({ allowed: false, code: "PRODUCTION_DISABLED" }); });
  it("rejects non-loopback and cross-origin requests", () => { expect(evaluateEarnExecutionAccess({ ...safe, hostname: "hodd.example" })).toMatchObject({ allowed: false, code: "LOCALHOST_REQUIRED" }); expect(evaluateEarnExecutionAccess({ ...safe, requestOrigin: "https://evil.example" })).toMatchObject({ allowed: false, code: "ORIGIN_MISMATCH" }); });
  it("rejects absent Origin, disabled flags and non-JSON payloads", () => {
    expect(evaluateEarnExecutionAccess({ ...safe, requestOrigin: null })).toMatchObject({ allowed: false, code: "ORIGIN_MISMATCH" });
    expect(evaluateEarnExecutionAccess({ ...safe, enabled: "false" })).toMatchObject({ allowed: false, code: "EXECUTION_DISABLED" });
    expect(evaluateEarnExecutionAccess({ ...safe, contentType: "text/plain" })).toMatchObject({ allowed: false, code: "JSON_REQUIRED" });
  });
});

describe("request host origin", () => {
  const request = (host: string | null, origin: string) => new Request("http://localhost:3001/api/earn/quote", { method: "POST", headers: { ...(host ? { host } : {}), origin, "content-type": "application/json" } });
  const decide = (req: Request) => { const actual = requestHostOrigin(req); return evaluateEarnExecutionAccess({ nodeEnv: "development", enabled: "true", hostname: actual.hostname, requestOrigin: req.headers.get("origin"), urlOrigin: actual.origin, contentType: req.headers.get("content-type") }); };
  it("accepts a 127.0.0.1 page even when next dev reports request.url as localhost", () => {
    expect(decide(request("127.0.0.1:3001", "http://127.0.0.1:3001"))).toEqual({ allowed: true });
    expect(decide(request("localhost:3001", "http://localhost:3001"))).toEqual({ allowed: true });
  });
  it("still blocks DNS rebinding and cross-origin pages", () => {
    expect(decide(request("evil.example:3001", "http://evil.example:3001"))).toMatchObject({ allowed: false, code: "LOCALHOST_REQUIRED" });
    expect(decide(request("127.0.0.1:3001", "http://evil.example"))).toMatchObject({ allowed: false, code: "ORIGIN_MISMATCH" });
    expect(decide(request("127.0.0.1:3001", "http://localhost:3001"))).toMatchObject({ allowed: false, code: "ORIGIN_MISMATCH" });
  });
});
