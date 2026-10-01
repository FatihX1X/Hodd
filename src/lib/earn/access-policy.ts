export type EarnAccessInput = Readonly<{ nodeEnv?: string; enabled?: string; hostname: string; requestOrigin: string | null; urlOrigin: string; contentType: string | null }>;
export type EarnAccessDecision = Readonly<{ allowed: true }> | Readonly<{ allowed: false; code: string; message: string; status: number }>;

export function evaluateEarnExecutionAccess(input: EarnAccessInput): EarnAccessDecision {
  if (input.nodeEnv !== "development") return { allowed: false, code: "PRODUCTION_DISABLED", message: "Onchain Earn execution is disabled outside local development.", status: 403 };
  if (input.enabled !== "true") return { allowed: false, code: "EXECUTION_DISABLED", message: "Set HODD_EARN_EXECUTION_ENABLED=true locally before submitting transactions.", status: 403 };
  if (!["localhost", "127.0.0.1", "[::1]", "::1"].includes(input.hostname)) return { allowed: false, code: "LOCALHOST_REQUIRED", message: "Earn execution is restricted to the local machine.", status: 403 };
  if (input.requestOrigin !== input.urlOrigin) return { allowed: false, code: "ORIGIN_MISMATCH", message: "The request origin is not allowed to execute transactions.", status: 403 };
  if (!input.contentType?.toLowerCase().startsWith("application/json")) return { allowed: false, code: "JSON_REQUIRED", message: "Earn execution accepts same-origin JSON requests only.", status: 415 };
  return { allowed: true };
}
