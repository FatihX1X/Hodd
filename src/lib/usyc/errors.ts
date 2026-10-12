/** A refusal with a plain-English message that is safe to show. Raw RPC errors never reach this type. */
export class UsycError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); this.name = "UsycError"; }
}

export const usycUnavailable = () => new UsycError("USYC_UNAVAILABLE", "USYC could not be read from Arc Testnet right now. Nothing was sent or changed; try again in a moment.", 503);
export const usycPaused = () => new UsycError("USYC_PAUSED", "Circle has paused USYC access for now, so nothing can be bought or redeemed. Nothing was sent. Try again later.", 503);
export const NOT_ALLOWLISTED_MESSAGE = "This wallet is not allowlisted for USYC yet. Circle must approve a wallet before it can buy, hold or redeem USYC. Nothing was sent.";
export const notAllowlisted = () => new UsycError("USYC_NOT_ALLOWLISTED", NOT_ALLOWLISTED_MESSAGE, 403);
