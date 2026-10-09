import "server-only";
import { getAddress } from "viem";
import { arcClient } from "@/lib/earn/gateway";
import { boundedArcGasPrice } from "@/lib/earn/gas";
import { nativeWeiToUsdcCeil } from "@/lib/earn/money";
import { digest } from "@/lib/earn/digest";
import { circleUserWalletClient } from "@/lib/circle/user-wallet-server";
import { decimalToIntegerCeil, walletFeeQuoteSchema } from "@/lib/wallet/fee-quote";
import type { PaymentContext } from "./server";
import { quoteModularPayment } from "@/lib/wallet/modular-server";

export async function quotePaymentFees(context: PaymentContext, call: { to: `0x${string}`; data: `0x${string}`; value: string }) {
  if (await arcClient.getChainId() !== 5042002) throw new Error("WRONG_FEE_CHAIN");
  // Do not estimate a smart account as an EOA or accept client sponsorship claims.
  if (context.wallet.provider === "CIRCLE_MODULAR") return quoteModularPayment(context.wallet, call);
  let gasLimit: bigint; let maxFee: bigint; let priorityFee: bigint; let source: "ARC_EOA" | "CIRCLE_UCW";
  if (context.wallet.provider === "CIRCLE_USER_CONTROLLED") {
    const circle = circleUserWalletClient();
    if (!circle || !context.userToken || !context.wallet.walletId || context.wallet.accountType !== "SCA") throw new Error("EMBEDDED_FEE_SESSION_REQUIRED");
    const { data } = await circle.estimateContractExecutionFee({ userToken: context.userToken, source: { walletId: context.wallet.walletId }, contractAddress: call.to, callData: call.data });
    const tier = data?.high;
    if (!tier?.gasLimit || !tier.maxFee || !tier.priorityFee || !/^\d+$/.test(tier.gasLimit)) throw new Error("CIRCLE_FEE_ESTIMATE_UNAVAILABLE");
    // Arc is not an L2. Unknown additional fee components cannot be bounded here.
    if (tier.l1Fee && decimalToIntegerCeil(tier.l1Fee, 18) !== 0n) throw new Error("UNSUPPORTED_ADDITIONAL_FEE");
    gasLimit = BigInt(tier.gasLimit) * 2n;
    const estimated = decimalToIntegerCeil(tier.maxFee, 9) * 2n;
    const price = boundedArcGasPrice(await arcClient.getGasPrice());
    maxFee = estimated > price ? estimated : price;
    priorityFee = decimalToIntegerCeil(tier.priorityFee, 9);
    source = "CIRCLE_UCW";
  } else {
    if (context.wallet.accountType !== "EOA") throw new Error("UNSUPPORTED_FEE_ACCOUNT");
    const [gas, price] = await Promise.all([arcClient.estimateGas({ account: getAddress(context.wallet.address), to: call.to, data: call.data, value: 0n }), arcClient.getGasPrice()]);
    gasLimit = gas * 2n; maxFee = boundedArcGasPrice(price); priorityFee = 0n; source = "ARC_EOA";
  }
  const observedAt = new Date().toISOString(); const budget = gasLimit * maxFee;
  return walletFeeQuoteSchema.parse({ provider: context.wallet.provider, walletAddress: context.wallet.address, chainId: 5042002, operationDigest: digest(call), observedAt, expiresAt: new Date(Date.parse(observedAt) + 300_000).toISOString(), sponsorship: "NOT_ASSUMED", gasLimit: gasLimit.toString(), maxFeePerGasWei: maxFee.toString(), priorityFeePerGasWei: priorityFee.toString(), maxNativeFeeWei: budget.toString(), maxWalletDebit: nativeWeiToUsdcCeil(budget.toString()), source });
}
