import { describe, expect, it } from "vitest";
import { evaluateEarnExecutionAccess } from "./access-policy";

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
