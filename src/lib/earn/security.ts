import "server-only";
import { evaluateExecutionAccess, executionModeFor, requestHostOrigin, type ExecutionEnv, type ExecutionMode } from "./access-policy";
import { liveControls } from "./live-controls";

export class EarnAccessError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}

export type ExecutionKind = "EARN" | "PAYMENT";

function executionEnv(kind: ExecutionKind): ExecutionEnv {
  return { nodeEnv: process.env.NODE_ENV, vercel: process.env.VERCEL, vercelEnv: process.env.VERCEL_ENV, liveFlag: process.env.HODD_TESTNET_LIVE, localFlag: kind === "EARN" ? process.env.HODD_EARN_EXECUTION_ENABLED : process.env.HODD_PAYMENT_EXECUTION_ENABLED };
}

/** Operator kill switch for the live host. Unreadable controls count as paused. */
async function livePaused(kind: ExecutionKind) {
  const controls = await liveControls();
  return !controls?.get("EXECUTION") || !controls.get(kind === "EARN" ? "EARN" : "PAYMENTS");
}

/** Mode for a hostname, including the operator switch. Display only. */
export async function hostExecutionMode(hostname: string, kind: ExecutionKind = "EARN"): Promise<ExecutionMode> {
  const env = executionEnv(kind);
  return executionModeFor(env, hostname, executionModeFor(env, hostname) === "TESTNET_LIVE" && await livePaused(kind));
}

/**
 * Every Earn and payment route: same-origin JSON (constant origin on the live
 * host). `execution` routes additionally require an open mode.
 */
export async function assertRequestAccess(request: Request, kind: ExecutionKind, execution: boolean): Promise<ExecutionMode> {
  const actual = requestHostOrigin(request);
  const env = executionEnv(kind);
  const paused = executionModeFor(env, actual.hostname) === "TESTNET_LIVE" && await livePaused(kind);
  const decision = evaluateExecutionAccess({ env, hostname: actual.hostname, hostOrigin: actual.origin, requestOrigin: request.headers.get("origin"), contentType: request.headers.get("content-type"), execution, paused });
  if (!decision.allowed) throw new EarnAccessError(decision.code, decision.message, decision.status);
  return decision.mode;
}

/** Live host only: each wallet provider is switched on separately. */
export async function assertProviderEnabled(mode: ExecutionMode, provider: string) {
  if (mode !== "TESTNET_LIVE") return;
  const controls = await liveControls();
  if (provider === "TEST_SIGNER" || !controls?.get(`PROVIDER:${provider}`)) throw new EarnAccessError("PROVIDER_PAUSED", "This wallet type is not enabled for live testnet execution yet. Choose another wallet.", 409);
}
