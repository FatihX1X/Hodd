import { describe, expect, it } from "vitest";
import { evaluateExecutionAccess, executionModeFor, LIVE_APP_ORIGIN, requestHostOrigin } from "./access-policy";

const local = { env: { nodeEnv: "development", localFlag: "true" }, hostname: "localhost", hostOrigin: "http://localhost:3000", requestOrigin: "http://localhost:3000", contentType: "application/json", execution: true };
const live = { env: { nodeEnv: "production", vercel: "1", vercelEnv: "production", liveFlag: "true" }, hostname: "app.hoddfinance.xyz", hostOrigin: LIVE_APP_ORIGIN, requestOrigin: LIVE_APP_ORIGIN, contentType: "application/json", execution: true };

describe("execution modes", () => {
  it("opens hosted execution only on the production live host with the opt-in flag", () => {
    expect(executionModeFor(live.env, "app.hoddfinance.xyz")).toBe("TESTNET_LIVE");
    expect(executionModeFor(live.env, "app.hoddfinance.xyz", true)).toBe("PAUSED");
    expect(executionModeFor({ ...live.env, liveFlag: undefined }, "app.hoddfinance.xyz")).toBe("PRODUCTION_DISABLED");
    expect(executionModeFor({ ...live.env, vercelEnv: "preview" }, "app.hoddfinance.xyz")).toBe("PRODUCTION_DISABLED");
    expect(executionModeFor(live.env, "hodd.vercel.app")).toBe("PRODUCTION_DISABLED");
    expect(executionModeFor(live.env, "hodd-git-branch-team.vercel.app")).toBe("PRODUCTION_DISABLED");
    // `next start` on a laptop is not Vercel, even with every flag set.
    expect(executionModeFor({ nodeEnv: "production", liveFlag: "true", vercelEnv: "production" }, "app.hoddfinance.xyz")).toBe("PRODUCTION_DISABLED");
  });
  it("opens local development only on loopback with the local flag", () => {
    expect(executionModeFor(local.env, "localhost")).toBe("LOCAL_ENABLED");
    expect(executionModeFor(local.env, "127.0.0.1")).toBe("LOCAL_ENABLED");
    expect(executionModeFor({ nodeEnv: "development" }, "localhost")).toBe("READ_ONLY");
    expect(executionModeFor({ ...local.env, vercel: "1" }, "localhost")).toBe("PRODUCTION_DISABLED");
  });
});

describe("execution access", () => {
  it("allows same-origin JSON on an open mode", () => {
    expect(evaluateExecutionAccess(local)).toEqual({ allowed: true, mode: "LOCAL_ENABLED" });
    expect(evaluateExecutionAccess(live)).toEqual({ allowed: true, mode: "TESTNET_LIVE" });
  });
  it("closes execution routes on closed modes but keeps read routes same-origin", () => {
    expect(evaluateExecutionAccess({ ...live, env: { ...live.env, liveFlag: "false" } })).toMatchObject({ allowed: false, code: "PRODUCTION_DISABLED" });
    expect(evaluateExecutionAccess({ ...live, paused: true })).toMatchObject({ allowed: false, code: "EXECUTION_PAUSED" });
    expect(evaluateExecutionAccess({ ...local, env: { nodeEnv: "development" } })).toMatchObject({ allowed: false, code: "EXECUTION_DISABLED" });
    expect(evaluateExecutionAccess({ ...live, env: { ...live.env, liveFlag: "false" }, execution: false })).toEqual({ allowed: true, mode: "PRODUCTION_DISABLED" });
  });
  it("compares the live origin to a constant, not to headers", () => {
    expect(evaluateExecutionAccess({ ...live, requestOrigin: "https://evil.example", hostOrigin: "https://evil.example" })).toMatchObject({ allowed: false, code: "ORIGIN_MISMATCH" });
    expect(evaluateExecutionAccess({ ...live, requestOrigin: "http://app.hoddfinance.xyz" })).toMatchObject({ allowed: false, code: "ORIGIN_MISMATCH" });
    expect(evaluateExecutionAccess({ ...live, requestOrigin: null })).toMatchObject({ allowed: false, code: "ORIGIN_MISMATCH" });
  });
  it("rejects non-JSON payloads and local rebinding hosts", () => {
    expect(evaluateExecutionAccess({ ...local, contentType: "text/plain" })).toMatchObject({ allowed: false, code: "JSON_REQUIRED" });
    expect(evaluateExecutionAccess({ ...local, hostname: "evil.example", hostOrigin: "http://evil.example:3000", requestOrigin: "http://evil.example:3000", execution: false })).toMatchObject({ allowed: false, code: "LOCALHOST_REQUIRED" });
  });
});

describe("request host origin", () => {
  const request = (host: string | null, origin: string) => new Request("http://localhost:3001/api/earn/quote", { method: "POST", headers: { ...(host ? { host } : {}), origin, "content-type": "application/json" } });
  const decide = (req: Request) => { const actual = requestHostOrigin(req); return evaluateExecutionAccess({ env: local.env, hostname: actual.hostname, hostOrigin: actual.origin, requestOrigin: req.headers.get("origin"), contentType: req.headers.get("content-type"), execution: true }); };
  it("accepts a 127.0.0.1 page even when next dev reports request.url as localhost", () => {
    expect(decide(request("127.0.0.1:3001", "http://127.0.0.1:3001"))).toMatchObject({ allowed: true });
    expect(decide(request("localhost:3001", "http://localhost:3001"))).toMatchObject({ allowed: true });
  });
  it("still blocks DNS rebinding and cross-origin pages", () => {
    expect(decide(request("evil.example:3001", "http://evil.example:3001"))).toMatchObject({ allowed: false, code: "LOCALHOST_REQUIRED" });
    expect(decide(request("127.0.0.1:3001", "http://evil.example"))).toMatchObject({ allowed: false, code: "ORIGIN_MISMATCH" });
    expect(decide(request("127.0.0.1:3001", "http://localhost:3001"))).toMatchObject({ allowed: false, code: "ORIGIN_MISMATCH" });
  });
});
