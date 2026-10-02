import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { assertLocalPaymentRequest } from "./security";
afterEach(() => vi.unstubAllEnvs());
const request = (origin = "http://localhost:3001") => new Request("http://localhost:3001/api/payments", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: "{}" });
describe("payment environment boundaries", () => {
  it("permits local reviews but requires a separate execution flag", () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", ""); vi.stubEnv("HODD_PAYMENT_EXECUTION_ENABLED", "false");
    expect(() => assertLocalPaymentRequest(request())).not.toThrow();
    expect(() => assertLocalPaymentRequest(request(), true)).toThrow();
  });
  it("rejects production, Vercel and cross-origin execution even with the flag", () => {
    vi.stubEnv("HODD_PAYMENT_EXECUTION_ENABLED", "true"); vi.stubEnv("NODE_ENV", "production");
    expect(() => assertLocalPaymentRequest(request(), true)).toThrow();
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", "1");
    expect(() => assertLocalPaymentRequest(request(), true)).toThrow();
    vi.stubEnv("VERCEL", "");
    expect(() => assertLocalPaymentRequest(request("https://evil.example"), true)).toThrow();
  });
});
