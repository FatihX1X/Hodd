// Never serialize raw SDK messages, request objects, headers or credentials.
const localCodes = new Set([
  "EMBEDDED_SESSION_REQUIRED", "EMBEDDED_SESSION_EXPIRED", "ENCODED_CALL_REQUIRED",
  "FEE_RESERVE_EXHAUSTED", "FEE_RESERVE_EXCEEDED", "FEE_CEILING_UNAVAILABLE",
  "GAS_PRICE_UNAVAILABLE", "GAS_ESTIMATE_UNAVAILABLE", "FRESH_POLICY_BLOCKED",
  "QUOTE_EXPIRED_OR_CANCELLED", "SIGNATURE_TIMEOUT", "USER_CANCELLED",
  "UNSUPPORTED_SIGNING_PAYLOAD", "TRANSACTION_NOT_VERIFIED",
  "TRANSACTION_PAYLOAD_MISMATCH", "EXECUTION_REQUIRES_REVIEW", "WORKSPACE_CHANGED",
  "SCA_FEE_CEILING_UNSUPPORTED", "SESSION_OR_WORKSPACE_CHANGED", "SEPARATE_TEST_WALLET_REQUIRED", "POSITION_UNAVAILABLE", "EARN_RECEIPT_NOT_VERIFIED", "APPROVAL_NOT_VERIFIED", "RECEIPT_REVERTED",
]);

export function safeEarnFailure(error: unknown, stage: string) {
  let code = "SDK_FAILURE";
  let providerCode: string | undefined;
  const seen = new Set<object>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > 5 || seen.has(value)) return;
    seen.add(value);
    const item = value as { message?: unknown; code?: unknown; circleCode?: unknown; value?: unknown; cause?: unknown; trace?: unknown; response?: { data?: unknown } };
    if (typeof item.message === "string" && localCodes.has(item.message)) code = item.message;
    if (typeof item.code === "string" && localCodes.has(item.code)) code = item.code;
    if ((typeof item.code === "number" || typeof item.code === "string") && /^\d{6}$/.test(String(item.code))) providerCode ??= String(item.code);
    if ((typeof item.circleCode === "number" || typeof item.circleCode === "string") && /^\d{6}$/.test(String(item.circleCode))) providerCode ??= String(item.circleCode);
    visit(item.cause, depth + 1); visit(item.trace, depth + 1); visit(item.value, depth + 1); visit(item.response?.data, depth + 1);
  };
  visit(error, 0);
  return { code, stage, ...(providerCode ? { providerCode } : {}) };
}
