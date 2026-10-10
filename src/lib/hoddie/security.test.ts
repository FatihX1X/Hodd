import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "@/test/fixtures";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ cookie: "", client: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => mocks.cookie ? { value: mocks.cookie } : undefined }) }));
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: mocks.client }));
import { hoddieContext, issueReview, newConsent, requireConsent, reserveUsage, sameOrigin, verifyReview, type HoddieContext } from "./security";
const context = (): HoddieContext => ({ userId: "owner", sessionId: "session", revision: 3, wallet: "wallet-digest", workspace: structuredClone(initialWorkspace), client: { rpc: vi.fn().mockResolvedValue({ error: null }) } as unknown as HoddieContext["client"] });
beforeEach(() => { vi.stubEnv("HODD_MCP_HANDLE_SECRET", "hoddie-unit-test-key-never-a-real-secret"); mocks.cookie = ""; vi.clearAllMocks(); });

describe("native Hoddie approval isolation", () => {
  it("requires renewed explicit consent for automatic two-provider routing", async () => {
    const owner = context(); mocks.cookie = newConsent(owner, "GEMINI");
    await expect(requireConsent(owner, "AUTO")).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    mocks.cookie = newConsent(owner, "AUTO"); const consent = await requireConsent(owner, "AUTO");
    const review = issueReview(owner, consent, "PROPOSAL", { safetyBuffer: "1" });
    expect(verifyReview(review.handle, owner, consent, "PROPOSAL").provider).toBe("AUTO");
    await expect(requireConsent({ ...owner, sessionId: "another" }, "AUTO")).rejects.toThrow();
    mocks.cookie = ""; await expect(requireConsent(owner, "AUTO")).rejects.toThrow();
  });
  it("requires explicit provider consent and binds it to the real user/session", async () => {
    const owner = context();
    await expect(requireConsent(owner, "GEMINI")).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    mocks.cookie = newConsent(owner, "GEMINI");
    expect((await requireConsent(owner, "GEMINI")).uid).toBe("owner");
    await expect(requireConsent(owner, "OPENROUTER")).rejects.toMatchObject({ code: "CONSENT_REQUIRED" });
    await expect(requireConsent({ ...owner, userId: "other" }, "GEMINI")).rejects.toThrow();
    await expect(requireConsent({ ...owner, sessionId: "other" }, "GEMINI")).rejects.toThrow();
  });
  it("binds proposal type, payload, owner, session, wallet, revision, provider and permission epoch", async () => {
    const owner = context(); mocks.cookie = newConsent(owner, "GEMINI"); const consent = await requireConsent(owner, "GEMINI");
    const { handle, payload } = issueReview(owner, consent, "PROPOSAL", { amount: "1.000001" }, 1000);
    expect(verifyReview(handle, owner, consent, "PROPOSAL", 1001).data.amount).toBe("1.000001");
    for (const field of [{ userId: "other" }, { sessionId: "other" }, { wallet: "new-wallet" }, { revision: 4 }]) expect(() => verifyReview(handle, { ...owner, ...field }, consent, "PROPOSAL", 1001)).toThrow();
    expect(() => verifyReview(handle, owner, { ...consent, provider: "OPENROUTER" }, "PROPOSAL", 1001)).toThrow();
    expect(() => verifyReview(handle, owner, { ...consent, nonce: "renewed" }, "PROPOSAL", 1001)).toThrow();
    expect(() => verifyReview(handle, owner, consent, "REFERENCE", 1001)).toThrow();
    expect(() => verifyReview(handle, owner, consent, "PROPOSAL", payload.exp)).toThrow();
    expect(() => verifyReview(`x${handle}`, owner, consent, "PROPOSAL", 1001)).toThrow();
  });
  it("fails closed on absent/cross-site Origin and unavailable atomic quota", async () => {
    for (const origin of [null, "https://attacker.example"]) expect(() => sameOrigin(new Request("https://hodd.example/api/hoddie/chat", { headers: origin ? { Origin: origin } : {} }))).toThrow();
    expect(() => sameOrigin(new Request("https://hodd.example/api/hoddie/chat", { headers: { Origin: "https://hodd.example" } }))).not.toThrow();
    const owner = context(); await reserveUsage(owner, "OPENROUTER", true);
    expect(owner.client.rpc).toHaveBeenCalledWith("hoddie_reserve_usage", { p_provider: "OPENROUTER", p_model_call: true });
    vi.mocked(owner.client.rpc).mockResolvedValueOnce({ error: { message: "sensitive raw database message" } } as never);
    await expect(reserveUsage(owner, "GEMINI", true)).rejects.toMatchObject({ code: "RATE_LIMIT", status: 429 });
  });
  it("rejects connector tokens and expired first-party sessions before reading treasury", async () => {
    for (const [clientId, active] of [["oauth-client", true], [undefined, false]]) {
      const from = vi.fn(); mocks.client.mockResolvedValue({ auth: { getUser: async () => ({ data: { user: { id: "owner" } } }), getClaims: async () => ({ data: { claims: { session_id: "session", client_id: clientId } } }) }, rpc: async () => ({ data: active }), from });
      await expect(hoddieContext()).rejects.toMatchObject({ code: "AUTH_REQUIRED" }); expect(from).not.toHaveBeenCalled();
    }
  });
});
