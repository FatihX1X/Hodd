// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "@/test/fixtures";
import { HoddieError } from "./models";
vi.mock("server-only", () => ({}));
const fake = vi.hoisted(() => ({ context: vi.fn(), consent: vi.fn(), usage: vi.fn(), parse: vi.fn(), availability: vi.fn(), resolve: vi.fn(), prepare: vi.fn(), select: vi.fn(), confirm: vi.fn(), live: vi.fn() }));
vi.mock("./security", async (original) => ({ ...await original<typeof import("./security")>(), hoddieContext: fake.context, requireConsent: fake.consent, reserveUsage: fake.usage }));
vi.mock("./provider", () => ({ providerAvailability: fake.availability, parseIntent: fake.parse }));
vi.mock("./service", () => ({ resolveIntent: fake.resolve, prepareChange: fake.prepare, resolveSelection: fake.select, confirmChange: fake.confirm }));
vi.mock("@/lib/agent/context", () => ({ liveWorkspace: fake.live }));
import { POST as chat } from "@/app/api/hoddie/chat/route";
import { POST as confirm } from "@/app/api/hoddie/confirm/route";
const request = (body: object, path = "chat", origin = "https://hodd.example") => new Request(`https://hodd.example/api/hoddie/${path}`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); fake.availability.mockReturnValue([{ id: "GEMINI", ready: true }, { id: "OPENROUTER", ready: true }]); fake.context.mockResolvedValue({ workspace: initialWorkspace }); fake.consent.mockResolvedValue({ provider: "GEMINI" }); fake.resolve.mockResolvedValue({ language: "en", message: "Canonical result", cards: [] }); fake.usage.mockResolvedValue(undefined); fake.live.mockResolvedValue({ workspace: initialWorkspace, source: "NOT_CONNECTED" }); });
describe("Hoddie native route boundary", () => {
  it("binds automatic reviews to explicit AUTO consent and returns the actual interpreter", async () => {
    fake.parse.mockRejectedValueOnce(new HoddieError("MODEL_UNAVAILABLE", "Unavailable", 503)).mockResolvedValueOnce({ action: "OVERVIEW" });
    const response = await chat(request({ mode: "MESSAGE", provider: "AUTO", message: "Update October payroll 1 USDC" }));
    expect(response.status).toBe(200); expect(await response.text()).toContain('"interpretedBy":"OPENROUTER"');
    expect(fake.consent).toHaveBeenCalledWith(expect.anything(), "AUTO");
    expect(fake.parse.mock.calls.map((call) => call[1])).toEqual(["Update [OBLIGATION1] [AMOUNT2] USDC", "Update [OBLIGATION1] [AMOUNT2] USDC"]);
    expect(fake.resolve).toHaveBeenCalledTimes(1); expect(fake.confirm).not.toHaveBeenCalled();
  });
  it("does not fall back when deterministic policy resolution fails", async () => {
    fake.parse.mockResolvedValueOnce({ action: "EARN_REQUEST" });
    fake.resolve.mockRejectedValueOnce(new HoddieError("POLICY_BLOCKED", "Blocked", 409));
    expect((await chat(request({ mode: "MESSAGE", provider: "AUTO", message: "deposit 1 USDC" }))).status).toBe(409);
    expect(fake.parse).toHaveBeenCalledTimes(1);
  });
  it("masks the command before exactly one provider call and returns only validated cards", async () => {
    const response = await chat(request({ mode: "MESSAGE", provider: "GEMINI", message: "Update October payroll 1500 USDC", timezone: "UTC" }));
    expect(response.status).toBe(200); expect(await response.text()).toContain("Canonical result");
    expect(fake.parse.mock.calls[0][1]).toBe("Update [OBLIGATION1] [AMOUNT2] USDC");
    expect(fake.parse).toHaveBeenCalledTimes(1); expect(fake.confirm).not.toHaveBeenCalled();
  });
  it("rejects cross-site, extra client policy/context and missing consent returns read-only fallback before a model call", async () => {
    expect((await chat(request({ mode: "MESSAGE", provider: "GEMINI", message: "Please interpret my request" }, "chat", "https://other.example"))).status).toBe(403);
    expect((await chat(request({ mode: "MESSAGE", provider: "GEMINI", message: "Please interpret my request", workspace: initialWorkspace }))).status).toBe(400);
    fake.consent.mockRejectedValue(new HoddieError("CONSENT_REQUIRED", "Allow first", 403));
    expect((await chat(request({ mode: "MESSAGE", provider: "GEMINI", message: "Please interpret my request" }))).status).toBe(200);
    expect(fake.parse).not.toHaveBeenCalled();
  });
  it("quota failure never reaches the provider, and provider errors are sanitized", async () => {
    fake.usage.mockRejectedValueOnce(new HoddieError("RATE_LIMIT", "Limit", 429));
    expect((await chat(request({ mode: "MESSAGE", provider: "GEMINI", message: "Please interpret my request" }))).status).toBe(429); expect(fake.parse).not.toHaveBeenCalled();
    fake.parse.mockRejectedValueOnce(new Error("upstream API key and headers"));
    expect(await (await chat(request({ mode: "MESSAGE", provider: "GEMINI", message: "Please interpret my request" }))).text()).not.toContain("API key and headers");
  });
  it("form preparation and confirmation never call a model or executable route", async () => {
    fake.prepare.mockResolvedValue({ language: "en", message: "Review", cards: [] });
    expect((await chat(request({ mode: "PREPARE", provider: "GEMINI", kind: "UPDATE_POLICY", change: { safetyBuffer: "1" } }))).status).toBe(200);
    expect(fake.usage).toHaveBeenCalledWith(expect.anything(), "GEMINI", false);
    expect((await confirm(request({ provider: "GEMINI", handle: "handle", confirmed: false }, "confirm"))).status).toBe(400); expect(fake.confirm).not.toHaveBeenCalled();
    fake.confirm.mockResolvedValue({ status: "READY", actionId: "action" });
    expect((await confirm(request({ provider: "GEMINI", handle: "handle", confirmed: true }, "confirm"))).status).toBe(200);
    expect(fake.confirm).toHaveBeenCalledTimes(1); expect(fake.parse).not.toHaveBeenCalled();
  });
});

describe("unified read-only API fallback", () => {
  it("answers recognized questions before consent, quota or interpretation", async () => {
    fake.consent.mockRejectedValue(new HoddieError("CONSENT_REQUIRED", "No consent", 403));
    const response = await chat(request({ mode: "MESSAGE", provider: "AUTO", message: "Hesabımı özetle" }));
    expect(response.status).toBe(200); const body = await response.text(); expect(body).toContain('"language":"tr"'); expect(body).toContain('"sources":');
    expect(fake.consent).not.toHaveBeenCalled(); expect(fake.usage).not.toHaveBeenCalled(); expect(fake.parse).not.toHaveBeenCalled(); expect(fake.confirm).not.toHaveBeenCalled();
  });
  it("without consent, a write command returns an answer with no proposal", async () => {
    fake.consent.mockRejectedValue(new HoddieError("CONSENT_REQUIRED", "No consent", 403));
    const response = await chat(request({ mode: "MESSAGE", provider: "AUTO", message: "Create a 500 USDC bill" }));
    expect(response.status).toBe(200); expect(await response.text()).not.toContain('"proposal"'); expect(fake.parse).not.toHaveBeenCalled(); expect(fake.prepare).not.toHaveBeenCalled();
  });
  it("without keys, skips quota and returns the full deterministic fallback", async () => {
    fake.availability.mockReturnValue([{ id: "GEMINI", ready: false }, { id: "OPENROUTER", ready: false }]);
    const response = await chat(request({ mode: "MESSAGE", provider: "AUTO", message: "Create a 500 USDC bill" }));
    expect(response.status).toBe(200); expect(await response.text()).toMatch(/cannot change|cannot.*move/); expect(fake.usage).not.toHaveBeenCalled(); expect(fake.parse).not.toHaveBeenCalled();
  });
  it("on total interpreter outage, returns no review or write", async () => {
    fake.parse.mockRejectedValue(new HoddieError("MODEL_UNAVAILABLE", "Unavailable", 503));
    const response = await chat(request({ mode: "MESSAGE", provider: "AUTO", message: "Create a 500 USDC bill" }));
    expect(response.status).toBe(200); expect(await response.text()).not.toContain('"proposal"'); expect(fake.parse).toHaveBeenCalledTimes(2); expect(fake.resolve).not.toHaveBeenCalled(); expect(fake.confirm).not.toHaveBeenCalled();
  });
  it("partial live data pauses financial answers", async () => {
    fake.live.mockResolvedValue({ workspace: initialWorkspace, source: "PARTIAL" });
    const response = await chat(request({ mode: "MESSAGE", provider: "AUTO", message: "How much is deployable?" }));
    const body = await response.text(); expect(body).toContain('"label":"PAUSED"'); expect(body).not.toContain("4,500"); expect(fake.parse).not.toHaveBeenCalled();
  });
});
