import "server-only";
import { generateText, Output } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { ADVISOR_INSTRUCTIONS, adviceSchema, type AdvisorModelCall } from "./advisor";
import { autopilotSecret } from "./secrets";

/** Groq's open-weight reasoning model with strict structured outputs. Override with AUTOPILOT_GROQ_MODEL. */
export const GROQ_ADVISOR_MODEL = "openai/gpt-oss-120b";

export function groqAdvisorModel() {
  const value = process.env.AUTOPILOT_GROQ_MODEL?.trim() || GROQ_ADVISOR_MODEL;
  if (!/^[a-z0-9][a-z0-9./_-]{2,80}$/i.test(value)) throw new Error("AGENT_ADVISOR_MODEL_INVALID");
  return value;
}

/** The advisor runs only with a server-side Groq key (env or Supabase Vault; never sent to the browser). */
export async function advisorConfigured() {
  return Boolean(await autopilotSecret("groq_api_key"));
}

/** One bounded call: no retries, 20 s, strict JSON schema. Errors are thrown bare and handled by adviseDecision. */
export const groqAdvisor: AdvisorModelCall = async (prompt, signal) => {
  const model = groqAdvisorModel();
  const apiKey = await autopilotSecret("groq_api_key");
  if (!apiKey) throw new Error("AGENT_ADVISOR_NOT_CONFIGURED");
  const result = await generateText({
    model: createGroq({ apiKey })(model),
    system: ADVISOR_INSTRUCTIONS,
    prompt,
    output: Output.object({ schema: adviceSchema }),
    providerOptions: { groq: { structuredOutputs: true, strictJsonSchema: true, ...(model.startsWith("openai/gpt-oss") ? { reasoningEffort: "medium" } : {}) } },
    maxOutputTokens: 2048,
    maxRetries: 0,
    timeout: 20_000,
    abortSignal: signal,
  });
  return { advice: result.output, provider: "GROQ", model };
};
