import { evaluateExecutionAccess, executionModeFor, requestHostOrigin, type EarnAccessDecision, type ExecutionEnv, type ExecutionMode } from "@/lib/earn/access-policy";

export type UsycControls = ReadonlyMap<string, boolean> | null;
export type UsycGate = EarnAccessDecision;

const CLOSED = "USYC trading is switched off by the operator. Nothing can be prepared right now.";

/**
 * Whether USYC quotes can be requested. Needs an open host (the live app host or a local build with the
 * execution flag) AND the operator's `EXECUTION` and `USYC` switches in `hodd_live_controls`. A missing
 * `USYC` row counts as OFF: the operator must insert it (`key = 'USYC'`, `enabled = true`) to open trading.
 * Reading a wallet's USYC status never depends on this.
 */
export function usycExecutionState(request: Request, env: ExecutionEnv, controls: UsycControls): { open: boolean; mode: ExecutionMode; note: string | null } {
  const mode = executionModeFor(env, requestHostOrigin(request).hostname);
  if (mode !== "LOCAL_ENABLED" && mode !== "TESTNET_LIVE") return { open: false, mode, note: mode === "READ_ONLY" ? "USYC trading is switched off in this local build." : "USYC trading is not available on this host." };
  if (controls?.get("EXECUTION") !== true || controls.get("USYC") !== true) return { open: false, mode, note: CLOSED };
  return { open: true, mode, note: null };
}

/**
 * POST gate: same-origin JSON always; `execution` (quotes) additionally needs an open host and both switches.
 * The operator switches are only loaded when a quote is requested.
 */
export async function usycGate(request: Request, env: ExecutionEnv, loadControls: () => Promise<UsycControls>, execution: boolean): Promise<UsycGate> {
  const actual = requestHostOrigin(request);
  const decision = evaluateExecutionAccess({ env, hostname: actual.hostname, hostOrigin: actual.origin, requestOrigin: request.headers.get("origin"), contentType: request.headers.get("content-type"), execution });
  if (!decision.allowed || !execution) return decision;
  const state = usycExecutionState(request, env, await loadControls());
  if (!state.open) return { allowed: false, code: "USYC_PAUSED", message: `${state.note ?? CLOSED}`, status: 503 };
  return { allowed: true, mode: state.mode };
}
