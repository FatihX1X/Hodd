import { evaluateExecutionAccess, executionModeFor, requestHostOrigin, type ExecutionEnv } from "@/lib/earn/access-policy";
export function agentAccess(request: Request, env: ExecutionEnv, controls: ReadonlyMap<string,boolean> | null, execution: boolean, cron = false) {
  const actual = requestHostOrigin(request);
  const mode = executionModeFor(env, actual.hostname);
  const open = (mode === "LOCAL_ENABLED" || mode === "TESTNET_LIVE") && controls?.get("EXECUTION") === true && controls.get("AGENT") === true;
  const result = evaluateExecutionAccess({env,hostname:actual.hostname,hostOrigin:actual.origin,requestOrigin:cron ? actual.origin : request.headers.get("origin"),contentType:cron ? "application/json" : request.headers.get("content-type"),execution});
  if (!result.allowed) return result;
  if (execution && !open) return {allowed:false as const,code:"AGENT_PAUSED",message:"Autopilot is disabled by the operator or unavailable on this host.",status:503};
  return {allowed:true as const, mode:open ? mode : "PAUSED" as const, open};
}
