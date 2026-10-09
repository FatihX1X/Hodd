import { beforeEach, describe, expect, it, vi } from "vitest";
import { initialWorkspace } from "@/lib/treasury/fixtures";
import { assessTreasury } from "@/lib/treasury/engine";
import { buildSnapshot } from "./snapshot";
import { askLanguageService, configuredProviders, HoddieUnavailableError } from "./providers";
import { resetRateLimit } from "./rate-limit";
import { chatRequestSchema, parseModelOutput } from "./schema";

vi.mock("server-only", () => ({}));
const requireUser = vi.fn();
vi.mock("@/lib/supabase/server", () => ({ requireSupabaseUser: () => requireUser() }));

const at = new Date("2026-09-27T00:00:00.000Z");
const snapshot = () => buildSnapshot(structuredClone(initialWorkspace), assessTreasury(initialWorkspace, at), at, null);
const request = (text = "Selam, ödemem yeter mi?") => chatRequestSchema.parse({ messages: [{ role: "user", text }], snapshot: snapshot() });
const output = (value: unknown) => JSON.stringify(value);
const geminiAnswer = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
const nvidiaAnswer = (text: string) => new Response(JSON.stringify({ choices: [{ message: { content: text } }] }));

describe("snapshot", () => {
  it("shares figures and obligation ids but never addresses, references or wallet data", () => {
    const workspace = structuredClone(initialWorkspace);
    workspace.obligations[0] = { ...workspace.obligations[0], recipientAddress: "0x1234567890123456789012345678901234567890", paymentReference: "ref-123" };
    const text = JSON.stringify(buildSnapshot(workspace, assessTreasury(workspace, at), at, null));
    expect(text).toContain("obl-payroll-oct");
    expect(text).not.toMatch(/0x1234|ref-123|walletConnection|recipientAddress|paymentReference/);
  });
});

describe("model output", () => {
  it("accepts a reply in any language with a valid proposed change", () => {
    const reply = parseModelOutput(output({ reply: "Kira faturasını hazırladım, onaylıyor musun?", language: "tr", labels: { approve: "Onaylıyorum", decline: "Vazgeç" }, action: { kind: "CREATE_OBLIGATION", change: { title: "Kira", amount: "500", dueDate: "2026-10-01" } } }));
    expect(reply).toMatchObject({ text: expect.stringContaining("Kira"), language: "tr", labels: { approve: "Onaylıyorum" }, action: { kind: "CREATE_OBLIGATION" }, actionRejected: false });
  });
  it("reads JSON wrapped in prose or code fences", () => {
    expect(parseModelOutput("```json\n{\"reply\":\"مرحبا\"}\n```")?.text).toBe("مرحبا");
  });
  it("falls back to plain text when the model ignores the format", () => {
    expect(parseModelOutput("Just a sentence.")).toMatchObject({ text: "Just a sentence.", action: null });
  });
  it("drops a proposed change that fails the connector schema and says so", () => {
    const reply = parseModelOutput(output({ reply: "Done", action: { kind: "CREATE_OBLIGATION", change: { title: "Rent", amount: "five hundred", dueDate: "soon" } } }));
    expect(reply).toMatchObject({ action: null, actionRejected: true });
  });
  it("accepts a Morpho request only with the connector's strict shape", () => {
    expect(parseModelOutput(output({ reply: "ok", action: { kind: "EARN_REQUEST", change: { operation: "DEPOSIT", amount: "100" } } }))).toMatchObject({ action: { kind: "EARN_REQUEST" } });
    expect(parseModelOutput(output({ reply: "ok", action: { kind: "EARN_REQUEST", change: { operation: "SWAP", amount: "100" } } }))).toMatchObject({ action: null, actionRejected: true });
    expect(parseModelOutput(output({ reply: "ok", action: { kind: "EARN_REQUEST", change: { operation: "DEPOSIT", amount: "100", recipient: "0xabc" } } }))).toMatchObject({ action: null, actionRejected: true });
  });
  it("never accepts payments or transfers", () => {
    for (const kind of ["PAYMENT_REQUEST", "TRANSFER"]) expect(parseModelOutput(output({ reply: "ok", action: { kind, change: { obligationId: "x" } } }))).toMatchObject({ action: null });
  });
  it("rejects requests whose last message is not from the user", () => {
    expect(chatRequestSchema.safeParse({ messages: [{ role: "user", text: "hi" }, { role: "assistant", text: "hello" }], snapshot: {} }).success).toBe(false);
  });
});

describe("language service chain", () => {
  it("is empty without keys and unavailable", async () => {
    expect(configuredProviders({})).toHaveLength(0);
    await expect(askLanguageService(request(), [])).rejects.toBeInstanceOf(HoddieUnavailableError);
  });

  it("uses the first provider and sends the user's own language through untouched", async () => {
    const fetcher = vi.fn(async () => geminiAnswer(output({ reply: "Evet, yeterli." })));
    const reply = await askLanguageService(request(), configuredProviders({ GEMINI_API_KEY: "k1", NVIDIA_API_KEY: "k2" }, fetcher as unknown as typeof fetch));
    expect(reply.text).toBe("Evet, yeterli.");
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("generativelanguage.googleapis.com");
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("k1");
    expect(String(init.body)).toContain("Selam, ödemem yeter mi?");
    expect(String(init.body)).toContain("whatever it is");
  });

  it("falls back to the second provider when the first fails or returns nonsense", async () => {
    const fetcher = vi.fn(async (url: string | URL | Request) => String(url).includes("googleapis") ? new Response("nope", { status: 500 }) : nvidiaAnswer(output({ reply: "Fallback ok" })));
    const reply = await askLanguageService(request(), configuredProviders({ GEMINI_API_KEY: "k1", NVIDIA_API_KEY: "k2" }, fetcher as unknown as typeof fetch));
    expect(reply.text).toBe("Fallback ok");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("is unavailable when every provider fails, without leaking the error", async () => {
    const fetcher = vi.fn(async () => new Response("down", { status: 503 }));
    await expect(askLanguageService(request(), configuredProviders({ GEMINI_API_KEY: "k1", NVIDIA_API_KEY: "k2" }, fetcher as unknown as typeof fetch))).rejects.toThrow("no provider answered");
  });

  it("honors the configured provider order and models", async () => {
    const fetcher = vi.fn(async () => nvidiaAnswer(output({ reply: "ok" })));
    await askLanguageService(request(), configuredProviders({ GEMINI_API_KEY: "k1", NVIDIA_API_KEY: "k2", HODDIE_PROVIDERS: "nvidia", HODDIE_NVIDIA_MODEL: "custom/model" }, fetcher as unknown as typeof fetch));
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("nvidia.com"); expect(JSON.parse(String(init.body)).model).toBe("custom/model");
  });
});

describe("POST /api/hoddie", () => {
  const post = async (body: unknown, headers: Record<string, string> = {}) => {
    const { POST } = await import("@/app/api/hoddie/route");
    return POST(new Request("https://app.example.test/api/hoddie", { method: "POST", headers: { "content-type": "application/json", host: "app.example.test", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) }));
  };
  beforeEach(() => { resetRateLimit(); requireUser.mockReset(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it("requires a signed-in user", async () => {
    requireUser.mockResolvedValue({ status: "UNAUTHENTICATED" });
    const response = await post({ messages: [{ role: "user", text: "hi" }], snapshot: {} });
    expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ code: "SIGN_IN_REQUIRED" });
  });

  it("rejects cross-origin browsers and malformed bodies", async () => {
    requireUser.mockResolvedValue({ status: "READY", userId: "u1" });
    expect((await post({ messages: [{ role: "user", text: "hi" }], snapshot: {} }, { origin: "https://evil.example" })).status).toBe(403);
    expect((await post("not json")).status).toBe(400);
    expect((await post({ messages: [], snapshot: {} })).status).toBe(400);
  });

  it("answers through the language service and rate limits bursts", async () => {
    requireUser.mockResolvedValue({ status: "READY", userId: "u2" });
    vi.stubEnv("GEMINI_API_KEY", "k1");
    vi.stubGlobal("fetch", vi.fn(async () => geminiAnswer(output({ reply: "Hola, todo bien." }))));
    const response = await post({ messages: [{ role: "user", text: "hola" }], snapshot: snapshot() });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "READY", reply: { text: "Hola, todo bien." } });
    let last = 200; for (let index = 0; index < 25; index += 1) last = (await post({ messages: [{ role: "user", text: "hola" }], snapshot: snapshot() })).status;
    expect(last).toBe(429);
  });

  it("is unavailable, never an error page, when no language service is configured", async () => {
    requireUser.mockResolvedValue({ status: "READY", userId: "u3" });
    const response = await post({ messages: [{ role: "user", text: "hola" }], snapshot: snapshot() });
    expect(response.status).toBe(503); expect(await response.json()).toMatchObject({ code: "UNAVAILABLE" });
  });
});
