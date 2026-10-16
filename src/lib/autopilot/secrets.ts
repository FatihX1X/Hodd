import "server-only";
import { agentDb } from "./store";

/**
 * Server-side Autopilot secrets. An environment variable wins; otherwise the value comes from Supabase Vault through
 * a service-role-only function (`hodd_autopilot_secret`), so the operator can set or rotate it without a redeploy.
 * Values are cached for five minutes per server instance and never logged or returned to a browser.
 */
export type AutopilotSecret = "groq_api_key" | "autopilot_scheduler_secret";
const fromEnv: Record<AutopilotSecret, () => string | undefined> = {
  groq_api_key: () => process.env.GROQ_API_KEY,
  autopilot_scheduler_secret: () => process.env.AUTOPILOT_SCHEDULER_SECRET,
};
const TTL_MS = 5 * 60_000;
const cache = new Map<AutopilotSecret, { value: string | null; at: number }>();

export async function autopilotSecret(name: AutopilotSecret, now = Date.now()): Promise<string | null> {
  const env = fromEnv[name]()?.trim();
  if (env) return env;
  const hit = cache.get(name);
  if (hit && now - hit.at < TTL_MS) return hit.value;
  try {
    const { data, error } = await agentDb().rpc("hodd_autopilot_secret", { p_name: name });
    if (error) return null; // not cached: a transient failure must not disable the advisor for five minutes
    const value = typeof data === "string" && data.trim() ? data.trim() : null;
    cache.set(name, { value, at: now });
    return value;
  } catch { return null; }
}

export function resetAutopilotSecrets() { cache.clear(); }
