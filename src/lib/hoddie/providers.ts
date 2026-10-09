import "server-only";

import { buildSystemPrompt } from "./prompt";
import { parseModelOutput, type ChatRequest, type HoddieModelReply } from "./schema";

/**
 * Language services behind Hoddie, tried in order until one answers. Which ones are active is
 * server configuration only (see .env.example); nothing about them reaches the browser.
 */
type Turn = ChatRequest["messages"][number];
type Provider = Readonly<{ id: string; call: (system: string, turns: readonly Turn[], signal: AbortSignal) => Promise<string> }>;
type Env = Readonly<Record<string, string | undefined>>;
type Fetch = typeof fetch;

const TIMEOUT_MS = 25_000;
const MAX_OUTPUT_TOKENS = 1_400;

async function postJson(fetcher: Fetch, url: string, headers: Record<string, string>, body: unknown, signal: AbortSignal) {
  const response = await fetcher(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal, cache: "no-store" });
  if (!response.ok) throw new Error(`provider status ${response.status}`);
  return response.json() as Promise<unknown>;
}

function geminiProvider(env: Env, fetcher: Fetch): Provider | null {
  const key = env.GEMINI_API_KEY?.trim(); if (!key) return null;
  const model = env.HODDIE_GEMINI_MODEL?.trim() || "gemini-2.5-flash";
  return { id: "primary", async call(system, turns, signal) {
    const data = await postJson(fetcher, `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": key }, {
      systemInstruction: { parts: [{ text: system }] },
      contents: turns.map((turn) => ({ role: turn.role === "user" ? "user" : "model", parts: [{ text: turn.text }] })),
      generationConfig: { temperature: 0.2, maxOutputTokens: MAX_OUTPUT_TOKENS, responseMimeType: "application/json" },
    }, signal) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
    const text = data.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("") ?? "";
    if (!text.trim()) throw new Error("empty provider answer");
    return text;
  } };
}

function nvidiaProvider(env: Env, fetcher: Fetch): Provider | null {
  const key = env.NVIDIA_API_KEY?.trim(); if (!key) return null;
  const model = env.HODDIE_NVIDIA_MODEL?.trim() || "meta/llama-3.3-70b-instruct";
  return { id: "secondary", async call(system, turns, signal) {
    const data = await postJson(fetcher, "https://integrate.api.nvidia.com/v1/chat/completions", { Authorization: `Bearer ${key}` }, {
      model, temperature: 0.2, max_tokens: MAX_OUTPUT_TOKENS, stream: false,
      messages: [{ role: "system", content: system }, ...turns.map((turn) => ({ role: turn.role, content: turn.text }))],
    }, signal) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new Error("empty provider answer");
    return text;
  } };
}

export function configuredProviders(env: Env = process.env, fetcher: Fetch = fetch): Provider[] {
  const order = (env.HODDIE_PROVIDERS ?? "gemini,nvidia").split(",").map((item) => item.trim().toLowerCase());
  const known: Record<string, Provider | null> = { gemini: geminiProvider(env, fetcher), nvidia: nvidiaProvider(env, fetcher) };
  return order.map((name) => known[name]).filter((provider): provider is Provider => Boolean(provider));
}

export class HoddieUnavailableError extends Error {}

/** Asks the first provider that answers with a valid reply; throws HoddieUnavailableError when none does. */
export async function askLanguageService(request: ChatRequest, providers: readonly Provider[] = configuredProviders()): Promise<HoddieModelReply> {
  if (providers.length === 0) throw new HoddieUnavailableError("not configured");
  const system = buildSystemPrompt(request.snapshot);
  // Gemini requires the conversation to start with the user.
  const turns = request.messages.slice(request.messages.findIndex((turn) => turn.role === "user"));
  for (const provider of providers) {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const reply = parseModelOutput(await provider.call(system, turns, controller.signal));
      if (reply) return reply;
    } catch { /* try the next provider; details are never logged because prompts contain account data */ }
    finally { clearTimeout(timer); }
  }
  throw new HoddieUnavailableError("no provider answered");
}
