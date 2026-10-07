import "server-only";
import { evaluateEarnExecutionAccess, requestHostOrigin } from "@/lib/earn/access-policy";
import { EarnAccessError } from "@/lib/earn/security";
export function assertLocalPaymentRequest(request: Request, execution = false) {
  const actual = requestHostOrigin(request);
  const access = evaluateEarnExecutionAccess({ nodeEnv: process.env.VERCEL ? "production" : process.env.NODE_ENV, enabled: execution ? process.env.HODD_PAYMENT_EXECUTION_ENABLED : "true", hostname: actual.hostname, requestOrigin: request.headers.get("origin"), urlOrigin: actual.origin, contentType: request.headers.get("content-type") });
  if (!access.allowed) throw new EarnAccessError(access.code, "Payment access denied: local development, matching Origin, JSON and an enabled execution flag are required.", access.status);
}
