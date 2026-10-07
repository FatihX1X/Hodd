import "server-only";
import { formatUnits } from "viem";
import { EarnAccessError } from "./security";

// Circle UCW SDK 10.8.1: SCA requires feeLevel (155232), not absolute fees.
// A feeLevel estimate is not a maximum debit. Until sponsorship can be
// verified before signing, never replace the approved ceiling with feeLevel.
export function assertBoundedEarnFeeProvider(wallet: { provider: string; accountType: string }) {
  if (wallet.provider === "CIRCLE_USER_CONTROLLED" && wallet.accountType === "SCA") {
    throw new EarnAccessError("SCA_FEE_CEILING_UNSUPPORTED", "Circle PIN/SCA Earn is unavailable: Circle requires feeLevel, which cannot enforce the approved maximum fee reserve. Verified gas sponsorship is required before signing. No challenge or transaction was submitted.", 409);
  }
}

export function boundedCircleChallengeFee(accountType: string, gasLimit: bigint, gasPrice: bigint) {
  assertBoundedEarnFeeProvider({ provider: "CIRCLE_USER_CONTROLLED", accountType });
  return { type: "absolute" as const, config: { gasLimit: gasLimit.toString(), maxFee: formatUnits(gasPrice, 9), priorityFee: formatUnits(gasPrice / 10n, 9) } };
}
