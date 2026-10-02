// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const fake = vi.hoisted(() => ({ review: vi.fn(), start: vi.fn(), inspect: vi.fn(), recheck: vi.fn(), reply: vi.fn(), context: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./server", () => ({ createPaymentProposal: fake.review }));
vi.mock("./jobs", () => ({ startPayment: fake.start, inspectPayment: fake.inspect, recheckPayment: fake.recheck, replyPayment: fake.reply }));
vi.mock("@/lib/earn/server-context", () => ({ earnServerContext: fake.context }));
import { POST } from "@/app/api/payments/route";
import { EarnAccessError } from "@/lib/earn/security";
const id = "11111111-1111-4111-8111-111111111111";
const request = (body: object, origin = "http://localhost:3001") => new Request("http://localhost:3001/api/payments", { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("VERCEL", ""); vi.stubEnv("HODD_PAYMENT_EXECUTION_ENABLED", "true"); fake.context.mockResolvedValue({ userId: "alice" }); fake.review.mockResolvedValue({ status: "READY" }); });
afterEach(() => vi.unstubAllEnvs());
describe("payment route", () => {
  it("rejects production and foreign origins before authentication or ledger access", async () => {
    vi.stubEnv("NODE_ENV", "production"); expect((await POST(request({ action: "CONFIRM", proposalId: id, confirmed: true }))).status).toBe(403);
    vi.stubEnv("NODE_ENV", "development"); expect((await POST(request({ action: "REVIEW", obligationId: "test" }, "https://evil.example"))).status).toBe(403);
    expect(fake.context).not.toHaveBeenCalled(); expect(fake.review).not.toHaveBeenCalled();
  });
  it("does not accept client-authored amounts, policies, wallets or limits", async () => {
    for (const key of ["amount", "policy", "wallet", "limit"]) expect((await POST(request({ action: "REVIEW", obligationId: "test", [key]: "forged" }))).status).toBe(400);
    expect(fake.review).not.toHaveBeenCalled();
  });
  it("requires separate explicit confirmation and the payment feature flag", async () => {
    expect((await POST(request({ action: "CONFIRM", proposalId: id }))).status).toBe(400);
    vi.stubEnv("HODD_PAYMENT_EXECUTION_ENABLED", "false"); expect((await POST(request({ action: "CONFIRM", proposalId: id, confirmed: true }))).status).toBe(403);
    expect(fake.start).not.toHaveBeenCalled();
  });
  it("sanitizes unexpected credential/provider errors", async () => {
    fake.review.mockRejectedValue(new Error("provider token must never appear"));
    const response = await POST(request({ action: "REVIEW", obligationId: "test" }));
    expect(response.status).toBe(503); expect(await response.text()).not.toContain("provider token");
    fake.context.mockRejectedValue(new EarnAccessError("AUTH_REQUIRED", "Sign in again.", 401));
    expect((await POST(request({ action: "STATUS", proposalId: id }))).status).toBe(401);
  });
});
