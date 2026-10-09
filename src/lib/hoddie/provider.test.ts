import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ generate: vi.fn(), google: vi.fn(() => "gemini-model"), router: vi.fn(() => "router-model") }));
vi.mock("ai", () => ({ generateText: mocks.generate, Output: { object: (value: unknown) => value } }));
vi.mock("@ai-sdk/google", () => ({ createGoogle: () => mocks.google }));
vi.mock("@openrouter/ai-sdk-provider", () => ({ createOpenRouter: () => mocks.router }));
const intent = { action: "OVERVIEW", language: "tr", obligationToken: null, amountToken: null, titleToken: null, dateToken: null, addressToken: null, dateMode: "NONE", useCurrentSelection: false, status: null, policyField: null, strategy: null, enabled: null, percentToken: null, targets: [], operation: null, route: null };
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.stubEnv("GEMINI_API_KEY", "fake-key-for-test"); vi.stubEnv("OPENROUTER_API_KEY", "fake-router-key"); vi.stubEnv("HODDIE_GEMINI_FREE_TIER_CONFIRMED", "true"); mocks.generate.mockResolvedValue({ output: intent }); });
describe("Hoddie single intent provider call", () => {
  it("passes only the masked command and a selection flag, no history/tools/results", async () => {
    const { parseIntent } = await import("./provider");
    expect(await parseIntent("GEMINI", "[OBLIGATION1] tutarını [AMOUNT2] yap", false)).toEqual(intent);
    const request = mocks.generate.mock.calls[0][0];
    expect(JSON.parse(request.prompt)).toEqual({ command: "[OBLIGATION1] tutarını [AMOUNT2] yap", hasSelectedObligation: false });
    expect(request).toMatchObject({ maxRetries: 0, maxOutputTokens: 2048 });
    for (const field of ["tools", "messages", "workspace", "balance", "activities"]) expect(request[field]).toBeUndefined();
    expect(JSON.stringify(request)).not.toContain("fake-key"); expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
  it("requires free-tier confirmation and never auto-retries failures", async () => {
    const { parseIntent } = await import("./provider"); vi.stubEnv("HODDIE_GEMINI_FREE_TIER_CONFIRMED", "false");
    await expect(parseIntent("GEMINI", "summary", false)).rejects.toMatchObject({ code: "PROVIDER_NOT_CONFIGURED" }); expect(mocks.generate).not.toHaveBeenCalled();
    vi.stubEnv("HODDIE_GEMINI_FREE_TIER_CONFIRMED", "true"); mocks.generate.mockRejectedValueOnce(new Error("secret upstream request"));
    await expect(parseIntent("GEMINI", "summary", false)).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" }); expect(mocks.generate).toHaveBeenCalledTimes(1);
  });
  it("verifies NVIDIA zero pricing and pins routing with no fallback", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { endpoints: [{ tag: "nvidia", pricing: { prompt: "0", completion: "0" }, supported_parameters: ["structured_outputs"] }] } })));
    const { parseIntent, OPENROUTER_MODEL } = await import("./provider"); await parseIntent("OPENROUTER", "summary", false);
    expect(mocks.router).toHaveBeenCalledWith(OPENROUTER_MODEL, { extraBody: { provider: { only: ["nvidia"], allow_fallbacks: false, require_parameters: true, max_price: { prompt: 0, completion: 0 } } } });
  });
  it("rejects changed price or unavailable free endpoint without a model call", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { endpoints: [{ tag: "nvidia", pricing: { prompt: "0.1", completion: "0" }, supported_parameters: ["structured_outputs"] }] } })));
    const { parseIntent } = await import("./provider"); await expect(parseIntent("OPENROUTER", "summary", false)).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" }); expect(mocks.generate).not.toHaveBeenCalled();
  });
});
