// Pure execution-access rules shared by Earn, payments and the dev test signer.

/** The only host where live Arc Testnet execution can run. Preview URLs and
 * hodd.vercel.app never match, and passkeys are bound to this domain. */
export const LIVE_APP_HOST = "app.hoddfinance.xyz";
export const LIVE_APP_ORIGIN = `https://${LIVE_APP_HOST}`;
const LOOPBACK = ["localhost", "127.0.0.1", "[::1]", "::1"];

export type ExecutionMode = "TESTNET_LIVE" | "LOCAL_ENABLED" | "READ_ONLY" | "PRODUCTION_DISABLED" | "PAUSED";
export type ExecutionEnv = Readonly<{ nodeEnv?: string; vercel?: string; vercelEnv?: string; liveFlag?: string; localFlag?: string }>;
export type EarnAccessDecision = Readonly<{ allowed: true; mode: ExecutionMode }> | Readonly<{ allowed: false; code: string; message: string; status: number }>;

export const isExecutionAvailable = (mode: ExecutionMode) => mode === "TESTNET_LIVE" || mode === "LOCAL_ENABLED";
const hosted = (env: ExecutionEnv) => Boolean(env.vercel) || env.nodeEnv !== "development";

/**
 * Host-dependent mode. Hosted builds open only on the production deployment
 * of the live app host with an explicit opt-in, and only while the operator
 * kill switch is on; everything else hosted stays closed. `next dev` opens
 * only on loopback with the local flag.
 */
export function executionModeFor(env: ExecutionEnv, hostname: string, paused = false): ExecutionMode {
  if (hosted(env)) {
    if (!env.vercel || env.vercelEnv !== "production" || env.liveFlag !== "true" || hostname !== LIVE_APP_HOST) return "PRODUCTION_DISABLED";
    return paused ? "PAUSED" : "TESTNET_LIVE";
  }
  if (!LOOPBACK.includes(hostname)) return "PRODUCTION_DISABLED";
  return env.localFlag === "true" ? "LOCAL_ENABLED" : "READ_ONLY";
}

export type AccessInput = Readonly<{ env: ExecutionEnv; hostname: string; hostOrigin: string; requestOrigin: string | null; contentType: string | null; execution: boolean; paused?: boolean }>;

/** Same-origin JSON always; transaction routes additionally need an open mode. */
export function evaluateExecutionAccess(input: AccessInput): EarnAccessDecision {
  // A rebinding host never reaches the local development server's handlers.
  if (!hosted(input.env) && !LOOPBACK.includes(input.hostname)) return { allowed: false, code: "LOCALHOST_REQUIRED", message: "Local development execution is restricted to this machine.", status: 403 };
  const mode = executionModeFor(input.env, input.hostname, input.paused);
  if (input.execution && mode === "PRODUCTION_DISABLED") return { allowed: false, code: "PRODUCTION_DISABLED", message: "Onchain execution is not available on this host.", status: 403 };
  if (input.execution && mode === "READ_ONLY") return { allowed: false, code: "EXECUTION_DISABLED", message: "Set HODD_EARN_EXECUTION_ENABLED / HODD_PAYMENT_EXECUTION_ENABLED locally before submitting transactions.", status: 403 };
  if (input.execution && mode === "PAUSED") return { allowed: false, code: "EXECUTION_PAUSED", message: "Live testnet execution is paused by the operator. No transaction was prepared.", status: 503 };
  // The live host compares against a constant, never a header-derived origin.
  const expected = mode === "TESTNET_LIVE" || mode === "PAUSED" ? LIVE_APP_ORIGIN : input.hostOrigin;
  if (!input.requestOrigin || input.requestOrigin !== expected) return { allowed: false, code: "ORIGIN_MISMATCH", message: "The request origin is not allowed to execute transactions.", status: 403 };
  if (!input.contentType?.toLowerCase().startsWith("application/json")) return { allowed: false, code: "JSON_REQUIRED", message: "Execution accepts same-origin JSON requests only.", status: 415 };
  return { allowed: true, mode };
}

/**
 * Origin the browser actually used. `next dev` reports request.url as localhost
 * even for 127.0.0.1 pages, so derive it from the Host header. Rebinding stays
 * blocked: a foreign site's Host is not loopback and fails the hostname gate.
 */
export function requestHostOrigin(request: Request) {
  const url = new URL(request.url);
  const host = request.headers.get("host");
  if (!host) return { hostname: url.hostname, origin: url.origin };
  try { const actual = new URL(`${url.protocol}//${host}`); return { hostname: actual.hostname, origin: actual.origin }; }
  catch { return { hostname: "", origin: "" }; }
}
