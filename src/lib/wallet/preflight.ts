/** Only failures before invoking the wallet's transaction API use this type. */
export class WalletPreflightError extends Error {
  constructor(public readonly code: "WALLET_PREFLIGHT_FAILED" | "WALLET_PROVIDER_UNAVAILABLE" | "WALLET_SESSION_CHANGED" | "FEE_RESERVE_EXCEEDED", message: string) {
    super(message); this.name = "WalletPreflightError";
  }
}

export async function walletPreflight<T>(readOnlyChecks: () => Promise<T>): Promise<T> {
  try { return await readOnlyChecks(); }
  catch (error) {
    if (error instanceof WalletPreflightError) throw error;
    // RPC errors can contain request context. Do not propagate them to UI/audit.
    throw new WalletPreflightError("WALLET_PREFLIGHT_FAILED", "Read-only account, network or gas checks failed before a wallet signature request. No transaction was submitted.");
  }
}
