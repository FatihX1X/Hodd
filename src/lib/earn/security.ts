import "server-only";

export class EarnAccessError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) { super(message); }
}

export function assertLocalEarnExecution(_request: Request) {
  void _request;
  // Shared developer-wallet execution is retired by the user-owned wallet model.
  throw new EarnAccessError("SIGNER_EXECUTION_DISABLED", "Connect a supported user-owned signer. Shared developer-wallet execution is disabled.", 403);
}

export function executionMode() {
  if (process.env.NODE_ENV !== "development") return "PRODUCTION_DISABLED" as const;
  return "READ_ONLY" as const;
}
