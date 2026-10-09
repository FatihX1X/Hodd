import { beforeEach, describe, expect, it, vi } from "vitest";
import { HoddieError } from "./models";
vi.mock("server-only", () => ({}));
const fake = vi.hoisted(() => ({ parse: vi.fn(), availability: vi.fn() }));
vi.mock("./provider", () => ({ parseIntent: fake.parse, providerAvailability: fake.availability }));
import { parseAutomaticIntent } from "./routing";
beforeEach(() => {
  vi.clearAllMocks();
  fake.availability.mockReturnValue([{ id: "GEMINI", ready: true }, { id: "OPENROUTER", ready: true }]);
  fake.parse.mockResolvedValue({ action: "OVERVIEW" });
});
describe("automatic masked-command routing", () => {
  it("prefers Gemini and does not contact NVIDIA on success", async () => {
    const reserve = vi.fn();
    expect(await parseAutomaticIntent("summary", false, reserve)).toMatchObject({ provider: "GEMINI" });
    expect(reserve).toHaveBeenCalledExactlyOnceWith("GEMINI");
    expect(fake.parse).toHaveBeenCalledExactlyOnceWith("GEMINI", "summary", false, undefined);
  });
  it("skips unconfigured or unconfirmed Gemini", async () => {
    fake.availability.mockReturnValue([{ id: "GEMINI", ready: false }, { id: "OPENROUTER", ready: true }]);
    const reserve = vi.fn();
    expect(await parseAutomaticIntent("[AMOUNT1] USDC", false, reserve)).toMatchObject({ provider: "OPENROUTER" });
    expect(reserve).toHaveBeenCalledExactlyOnceWith("OPENROUTER");
  });
  it("falls back once with the same masked input and a separate quota reservation", async () => {
    fake.parse.mockRejectedValueOnce(new HoddieError("MODEL_UNAVAILABLE", "Gemini unavailable", 503));
    const reserve = vi.fn();
    expect(await parseAutomaticIntent("[OBLIGATION1] [AMOUNT2]", true, reserve)).toMatchObject({ provider: "OPENROUTER" });
    expect(reserve.mock.calls).toEqual([["GEMINI"], ["OPENROUTER"]]);
    expect(fake.parse.mock.calls).toEqual([["GEMINI", "[OBLIGATION1] [AMOUNT2]", true, undefined], ["OPENROUTER", "[OBLIGATION1] [AMOUNT2]", true, undefined]]);
  });
  it("fails closed after both providers fail, without a third attempt", async () => {
    fake.parse.mockRejectedValue(new HoddieError("MODEL_UNAVAILABLE", "sensitive upstream details", 503));
    await expect(parseAutomaticIntent("summary", false, vi.fn())).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
    expect(fake.parse).toHaveBeenCalledTimes(2);
  });
  it("does not bypass the daily fallback budget or a user rate limit", async () => {
    fake.parse.mockRejectedValueOnce(new HoddieError("MODEL_UNAVAILABLE", "Unavailable", 503));
    const reserve = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new HoddieError("RATE_LIMIT", "Limit", 429));
    await expect(parseAutomaticIntent("summary", false, reserve)).rejects.toMatchObject({ code: "RATE_LIMIT" });
    expect(fake.parse).toHaveBeenCalledTimes(1);
  });
  it("never falls back on cancellation or non-provider failures", async () => {
    const controller = new AbortController();
    fake.parse.mockImplementationOnce(() => { controller.abort(); throw new HoddieError("MODEL_UNAVAILABLE", "Cancelled", 503); });
    await expect(parseAutomaticIntent("summary", false, vi.fn(), controller.signal)).rejects.toThrow();
    expect(fake.parse).toHaveBeenCalledTimes(1);
    fake.parse.mockRejectedValueOnce(new HoddieError("POLICY_BLOCKED", "Blocked", 409));
    await expect(parseAutomaticIntent("summary", false, vi.fn())).rejects.toMatchObject({ code: "POLICY_BLOCKED" });
    expect(fake.parse).toHaveBeenCalledTimes(2);
  });
  it("does not reserve quota or send a command when no provider is configured", async () => {
    fake.availability.mockReturnValue([]); const reserve = vi.fn();
    await expect(parseAutomaticIntent("summary", false, reserve)).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" });
    expect(reserve).not.toHaveBeenCalled(); expect(fake.parse).not.toHaveBeenCalled();
  });
});
