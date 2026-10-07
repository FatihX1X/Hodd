// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { testSignerAccount } from "./test-signer";
// Synthetic key used only by this unit test.
const key = `0x${"11".repeat(32)}`;
const enable = (overrides: Record<string, string | undefined> = {}) => {
  vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", ""); vi.stubEnv("HODD_TEST_SIGNER_ENABLED", "true"); vi.stubEnv("HODD_TEST_SIGNER_PRIVATE_KEY", key);
  for (const [name, value] of Object.entries(overrides)) vi.stubEnv(name, value as string);
};
afterEach(() => { vi.unstubAllEnvs(); });
describe("local test signer gates", () => {
  it("exists only in development, on loopback, with the flag and a valid key", () => {
    enable(); expect(testSignerAccount("127.0.0.1")?.address).toMatch(/^0x[\da-fA-F]{40}$/); expect(testSignerAccount("localhost")).not.toBeNull();
  });
  it.each([
    ["production", { NODE_ENV: "production" }, "127.0.0.1"],
    ["Vercel", { VERCEL: "1" }, "127.0.0.1"],
    ["flag off", { HODD_TEST_SIGNER_ENABLED: "false" }, "127.0.0.1"],
    ["missing key", { HODD_TEST_SIGNER_PRIVATE_KEY: "" }, "127.0.0.1"],
    ["malformed key", { HODD_TEST_SIGNER_PRIVATE_KEY: "0x1234" }, "127.0.0.1"],
    ["remote host", {}, "hodd.example.com"],
  ])("is unavailable for %s", (_name, overrides, host) => { enable(overrides); expect(testSignerAccount(host)).toBeNull(); });
});
