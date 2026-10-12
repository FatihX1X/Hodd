import "server-only";
import { formatUnits, getAddress } from "viem";
import { arcClient } from "@/lib/earn/gateway";
import { SELECTOR_DEPOSIT, SELECTOR_REDEEM, SELECTOR_TRANSFER, USYC_AUTHORITY, USYC_TELLER, USYC_TOKEN, authorityAbi, tellerAbi, usycTokenAbi } from "./constants";
import { usycUnavailable } from "./errors";
import type { UsycPosition } from "./models";

const ONE = 1_000_000n; // one USDC or one USYC, used to read the current prices

/**
 * One fresh, read-only look at a wallet's USYC position on Arc Testnet: allowlist, balance and value, prices,
 * fee rates and today's limits. Nothing is sent. Any read failure becomes a plain "unavailable" error; raw RPC
 * text never leaves the server. A paused authority is reported as `authority: "PAUSED"` (holdings still show).
 */
export async function readUsycStatus(walletAddress: string, now = new Date()): Promise<UsycPosition> {
  const wallet = getAddress(walletAddress);
  const teller = { address: USYC_TELLER, abi: tellerAbi } as const;
  try {
    const [balance, paused, today, subscribePreview, subscribeRate, redeemRate] = await Promise.all([
      arcClient.readContract({ address: USYC_TOKEN, abi: usycTokenAbi, functionName: "balanceOf", args: [wallet] }),
      arcClient.readContract({ address: USYC_AUTHORITY, abi: authorityAbi, functionName: "paused" }),
      arcClient.readContract({ ...teller, functionName: "todayTimestamp" }),
      arcClient.readContract({ ...teller, functionName: "previewDepositData", args: [wallet, ONE] }),
      arcClient.readContract({ ...teller, functionName: "subscriptionFeeRate", args: [wallet] }),
      arcClient.readContract({ ...teller, functionName: "redemptionFeeRate", args: [wallet] }),
    ]);
    const canCall = (selector: typeof SELECTOR_DEPOSIT | typeof SELECTOR_REDEEM | typeof SELECTOR_TRANSFER, target: `0x${string}`) =>
      paused ? Promise.resolve(false) : arcClient.readContract({ address: USYC_AUTHORITY, abi: authorityAbi, functionName: "canCall", args: [wallet, target, selector] });
    const [redeemPreview, value, subscribeLeft, redeemLeft, maxRedeem, mayDeposit, mayRedeem, mayReceive] = await Promise.all([
      arcClient.readContract({ ...teller, functionName: "previewRedeemData", args: [wallet, ONE] }),
      balance > 0n ? arcClient.readContract({ ...teller, functionName: "convertToAssets", args: [balance] }) : Promise.resolve(0n),
      arcClient.readContract({ ...teller, functionName: "subscriptionLimitRemaining", args: [wallet, today] }),
      arcClient.readContract({ ...teller, functionName: "redemptionLimitRemaining", args: [wallet, today] }),
      arcClient.readContract({ ...teller, functionName: "maxRedeem", args: [wallet] }),
      canCall(SELECTOR_DEPOSIT, USYC_TELLER),
      canCall(SELECTOR_REDEEM, USYC_TELLER),
      canCall(SELECTOR_TRANSFER, USYC_TOKEN),
    ]);
    const latestPrice = redeemPreview[2], subscribePrice = subscribePreview[2];
    if (latestPrice <= 0n || subscribePrice <= 0n) throw new Error("Invalid USYC price");
    // maxRedeem is already capped by the balance; value it with the same Teller conversion.
    const maxValue = maxRedeem === 0n ? 0n : maxRedeem === balance ? value : await arcClient.readContract({ ...teller, functionName: "convertToAssets", args: [maxRedeem] });
    return {
      wallet,
      authority: paused ? "PAUSED" : "OK",
      // The Teller needs the entitlement to call the function AND the entitlement to receive/move USYC.
      allowlisted: { subscribe: mayDeposit && mayReceive, redeem: mayRedeem && mayReceive, receive: mayReceive },
      balanceShares: balance.toString(),
      valueUsdc: value.toString(),
      priceUsdcPerUsyc: latestPrice.toString(),
      subscribePriceUsdcPerUsyc: subscribePrice.toString(),
      // Subscriptions after the 14:00 New York cutoff, or with an oracle price not updated today, use the next price.
      afterHoursPricing: subscribePrice !== latestPrice,
      fees: { subscribePercent: formatUnits(subscribeRate, 18), redeemPercent: formatUnits(redeemRate, 18) },
      limitsRemaining: { subscribe: subscribeLeft.toString(), redeem: redeemLeft.toString() },
      maxRedeemShares: maxRedeem.toString(),
      maxRedeemValueUsdc: maxValue.toString(),
      observedAt: now.toISOString(),
    };
  } catch { throw usycUnavailable(); }
}
