import "server-only";
import { evaluateEarnExecutionAccess } from "@/lib/earn/access-policy";
import { EarnAccessError } from "@/lib/earn/security";
export function assertLocalPaymentRequest(request: Request, execution = false) {
  const url = new URL(request.url);
  const access = evaluateEarnExecutionAccess({ nodeEnv: process.env.VERCEL ? "production" : process.env.NODE_ENV, enabled: execution ? process.env.HODD_PAYMENT_EXECUTION_ENABLED : "true", hostname: url.hostname, requestOrigin: request.headers.get("origin"), urlOrigin: url.origin, contentType: request.headers.get("content-type") });
  if (!access.allowed) throw new EarnAccessError(access.code, "Payment access denied: local development, matching Origin, JSON and an enabled execution flag are required.", access.status);
}
