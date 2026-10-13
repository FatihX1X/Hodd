/** A refusal with a plain-English message that is safe to show. Raw RPC errors never reach this type. */
export class UsycError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); this.name = "UsycError"; }
}

export const usycUnavailable = () => new UsycError("USYC_UNAVAILABLE", "USYC could not be read from Arc Testnet right now. Nothing was sent or changed; try again in a moment.", 503);
export const usycPaused = () => new UsycError("USYC_PAUSED", "Circle has paused USYC access for now, so nothing can be bought or redeemed. Nothing was sent. Try again later.", 503);
export const poolNotDeployed = () => new UsycError("USYC_POOL_NOT_DEPLOYED", "Hodd's USYC pool is not live on Arc Testnet yet. Nothing was sent.", 409);
export const circleNotPermitted = () => new UsycError("USYC_POOL_NOT_PERMITTED", "Circle has not enabled Hodd's USYC pool yet (or has paused it), so nothing can be bought or redeemed right now. Your funds stay where they are. Nothing was sent.", 409);
