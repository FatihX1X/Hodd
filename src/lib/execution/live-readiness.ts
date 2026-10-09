import "server-only";
import type { ExecutionMode } from "@/lib/earn/access-policy";
import { assertProviderEnabled, EarnAccessError } from "@/lib/earn/security";
import type { earnServerContext } from "@/lib/earn/server-context";

type Context = Awaited<ReturnType<typeof earnServerContext>>;
export type UsageKind = "QUOTE" | "START" | "ADVANCE" | "CIRCLE_SESSION" | "OWNERSHIP";

/** Public testnet demo cap for deposits and payments. Withdrawals are never capped. */
export const LIVE_MAX_OPERATION_MINOR = 1_000_000_000n;

/** Counts the request against per-user and global limits (live host only). */
export async function reserveLiveUsage(client: Context["client"], mode: ExecutionMode, kind: UsageKind) {
  if (mode !== "TESTNET_LIVE") return;
  const { error } = await client.rpc("hodd_reserve_live_usage", { p_kind: kind });
  if (!error) return;
  if (/rate limit/i.test(error.message)) throw new EarnAccessError("RATE_LIMITED", "Too many requests for the live testnet demo. Wait a minute and try again.", 429);
  throw new EarnAccessError("USAGE_UNAVAILABLE", "The request limit service is unavailable. Nothing was prepared; try again shortly.", 503);
}

/**
 * Public sign-up lets anyone type any address into a workspace. A wallet's
 * global lease must only be held by someone who signed for that wallet.
 * Circle PIN wallets are already proven by Circle's wallet list.
 */
export async function assertWalletOwnership(context: Context, mode: ExecutionMode) {
  if (mode !== "TESTNET_LIVE" || context.wallet.provider === "CIRCLE_USER_CONTROLLED") return;
  const { data, error } = await context.client.from("wallet_ownership_proofs").select("wallet_address").eq("user_id", context.userId).eq("wallet_address", context.wallet.address.toLowerCase()).maybeSingle();
  if (error) throw new EarnAccessError("OWNERSHIP_UNAVAILABLE", "Wallet ownership could not be checked. Try again shortly.", 503);
  if (!data) throw new EarnAccessError("OWNERSHIP_REQUIRED", "Verify that you control this wallet (one free signature from the wallet panel) before live testnet operations.", 403);
}

export function assertLiveAmount(mode: ExecutionMode, minorUnits: string) {
  if (mode === "TESTNET_LIVE" && BigInt(minorUnits) > LIVE_MAX_OPERATION_MINOR) throw new EarnAccessError("LIVE_AMOUNT_LIMIT", "The live testnet demo limits each deposit or payment to 1,000 USDC.", 409);
}

/** Provider switch, ownership proof and usage reservation, in that order. */
export async function assertLiveReady(context: Context, mode: ExecutionMode, usage: UsageKind) {
  await assertProviderEnabled(mode, context.wallet.provider);
  await assertWalletOwnership(context, mode);
  await reserveLiveUsage(context.client, mode, usage);
}
