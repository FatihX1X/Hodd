import "server-only";
import { getAddress } from "viem";
import { arcClient } from "@/lib/earn/gateway";
import { SELECTOR_DEPOSIT, SELECTOR_REDEEM, SELECTOR_TRANSFER, USYC_AUTHORITY, USYC_TELLER, USYC_TOKEN, authorityAbi, poolAbi, tellerAbi, usycPoolAddress } from "./constants";
import { usycUnavailable } from "./errors";
import type { UsycPosition } from "./models";

const ONE = 1_000_000n; // one USDC or one USYC, used to read the current prices

/**
 * One fresh, read-only look at a wallet's place in Hodd's USYC pool: shares and their USDC value, what can be
 * deposited or withdrawn right now, and Circle's side of the pool (allowlisted, paused). Nothing is sent.
 * Returns null while the pool is not deployed. Read failures become a plain "unavailable" error.
 */
export async function readUsycStatus(walletAddress: string, now = new Date(), pool = usycPoolAddress()): Promise<UsycPosition | null> {
  if (!pool) return null;
  const wallet = getAddress(walletAddress);
  const vault = { address: pool, abi: poolAbi } as const, teller = { address: USYC_TELLER, abi: tellerAbi } as const;
  try {
    const [shares, depositsPaused, maxDeposit, maxRedeem, paused, subscribePreview, redeemPreview] = await Promise.all([
      arcClient.readContract({ ...vault, functionName: "balanceOf", args: [wallet] }),
      arcClient.readContract({ ...vault, functionName: "depositsPaused" }),
      arcClient.readContract({ ...vault, functionName: "maxDeposit", args: [wallet] }),
      arcClient.readContract({ ...vault, functionName: "maxRedeem", args: [wallet] }),
      arcClient.readContract({ address: USYC_AUTHORITY, abi: authorityAbi, functionName: "paused" }),
      arcClient.readContract({ ...teller, functionName: "previewDepositData", args: [pool, ONE] }),
      arcClient.readContract({ ...teller, functionName: "previewRedeemData", args: [pool, ONE] }),
    ]);
    // The pool itself must be allowlisted: it calls the Teller and holds the USYC. Users never need it.
    const can = (target: `0x${string}`, selector: `0x${string}`) => arcClient.readContract({ address: USYC_AUTHORITY, abi: authorityAbi, functionName: "canCall", args: [pool, target, selector] });
    const permitted = paused ? false : (await Promise.all([can(USYC_TELLER, SELECTOR_DEPOSIT), can(USYC_TELLER, SELECTOR_REDEEM), can(USYC_TOKEN, SELECTOR_TRANSFER)])).every(Boolean);
    const [usyc, value, maxValue] = await Promise.all([
      shares > 0n ? arcClient.readContract({ ...vault, functionName: "usycOf", args: [shares] }) : Promise.resolve(0n),
      shares > 0n ? arcClient.readContract({ ...vault, functionName: "previewRedeem", args: [shares] }) : Promise.resolve(0n),
      maxRedeem === 0n ? Promise.resolve(0n) : maxRedeem === shares ? Promise.resolve(-1n) : arcClient.readContract({ ...vault, functionName: "previewRedeem", args: [maxRedeem] }),
    ]);
    const latestPrice = redeemPreview[2], subscribePrice = subscribePreview[2];
    if (latestPrice <= 0n || subscribePrice <= 0n) throw new Error("Invalid USYC price");
    return {
      wallet, pool,
      circle: paused ? "PAUSED" : permitted ? "OK" : "NOT_PERMITTED",
      depositsPaused,
      maxDepositUsdc: maxDeposit.toString(),
      shares: shares.toString(),
      usycMinor: usyc.toString(),
      valueUsdc: value.toString(),
      maxWithdrawShares: maxRedeem.toString(),
      maxWithdrawUsdc: (maxValue === -1n ? value : maxValue).toString(),
      priceUsdcPerUsyc: latestPrice.toString(),
      subscribePriceUsdcPerUsyc: subscribePrice.toString(),
      afterHoursPricing: subscribePrice !== latestPrice,
      observedAt: now.toISOString(),
    };
  } catch { throw usycUnavailable(); }
}
