import "server-only";
import { evaluateEarnExecutionAccess } from "./access-policy";

export class EarnAccessError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}

export function assertLocalEarnExecution(request: Request) {
  const url = new URL(request.url);
  const decision = evaluateEarnExecutionAccess({ nodeEnv: process.env.NODE_ENV, enabled: process.env.HODD_EARN_EXECUTION_ENABLED, hostname: url.hostname, requestOrigin: request.headers.get("origin"), urlOrigin: url.origin, contentType: request.headers.get("content-type") });
  if (!decision.allowed) throw new EarnAccessError(decision.code, decision.message, decision.status);
}

export function executionMode() {
  if (process.env.NODE_ENV !== "development") return "PRODUCTION_DISABLED" as const;
  return process.env.HODD_EARN_EXECUTION_ENABLED === "true" ? "LOCAL_ENABLED" as const : "READ_ONLY" as const;
}
