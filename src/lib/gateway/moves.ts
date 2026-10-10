import "server-only";
import { getAddress, verifyTypedData } from "viem";
import { z } from "zod";
import type { ExecutionMode } from "@/lib/earn/access-policy";
import { arcClient } from "@/lib/earn/gateway";
import { digest } from "@/lib/earn/digest";
import { EarnAccessError } from "@/lib/earn/security";
import type { earnServerContext } from "@/lib/earn/server-context";
import { assertLiveAmount, assertLiveReady } from "@/lib/execution/live-readiness";
import { GatewayApiError, estimateForwardedTransfer, gatewayBalances, gatewayTransferStatus, submitForwardedTransfer } from "./api";
import { gatewayChainByKey } from "./chains";
import { openGatewayHandle, sealGatewayHandle } from "./handles";
import { buildArcTransferSpec, burnIntentSchema, burnIntentTypedData, burnIntentTypedDataJson, fromBytes32, type BurnIntent } from "./intent";
import type { GatewayMove } from "./models";
import { verifyGatewayMint } from "./receipts";

type Context = Awaited<ReturnType<typeof earnServerContext>>;
const QUOTE_TTL_MS = 5 * 60_000;
const money = (minor: bigint | string) => ({ currency: "USDC" as const, decimals: 6 as const, minorUnits: minor.toString() });
const quoteHandle = z.object({ kind: z.literal("MOVE_QUOTE"), uid: z.string(), binding: z.string(), wallet: z.string(), sourceKey: z.string(), intent: z.string(), startBlock: z.string(), forwardingFee: z.string(), exp: z.number() }).strict();
const submittedHandle = z.object({ kind: z.literal("MOVE_SUBMITTED"), uid: z.string(), wallet: z.string(), sourceKey: z.string(), intent: burnIntentSchema, startBlock: z.string(), transferId: z.string().uuid(), fee: z.string(), forwardingFee: z.string() }).strict();

/** Gateway signing needs a key that signs EIP-712 directly. Smart accounts stay read-only here. */
export function assertGatewaySigner(context: Context) {
  if (context.wallet.accountType !== "EOA") throw new EarnAccessError("GATEWAY_EOA_REQUIRED", "Cross-chain moves currently need a MetaMask or Rabby wallet. Circle smart wallets can still see their balances.", 409);
}

export async function verifyIntentSignature(intent: BurnIntent, signature: `0x${string}`, signer: string) {
  const typed = burnIntentTypedData(intent);
  const valid = await verifyTypedData({ address: getAddress(signer), domain: typed.domain, types: typed.types, primaryType: typed.primaryType, message: typed.message, signature }).catch(() => false);
  if (!valid) throw new EarnAccessError("GATEWAY_SIGNATURE_INVALID", "The signature does not match this transfer and wallet. Nothing was sent.", 400);
}

function moveView(input: { stage: GatewayMove["stage"]; handle: string; sourceKey: string; intent: BurnIntent; fee: string; forwardingFee: string; transferId: string | null; mintTxHash: string | null; message: string; withTypedData?: boolean }): GatewayMove {
  return {
    status: "READY", stage: input.stage, handle: input.handle, sourceKey: input.sourceKey, amount: money(input.intent.spec.value), fee: money(input.fee), forwardingFee: money(input.forwardingFee),
    recipient: fromBytes32(input.intent.spec.destinationRecipient), intent: input.intent, transferId: input.transferId, mintTxHash: input.mintTxHash, message: input.message,
    ...(input.withTypedData ? { typedData: burnIntentTypedDataJson(input.intent) } : {}),
  };
}

/** Builds a Gateway → Arc move into the signed-in user's own wallet. Signing is free; Circle submits the Arc mint. */
export async function quoteGatewayMove(context: Context, mode: ExecutionMode, sourceKey: string, amountMinor: bigint): Promise<GatewayMove> {
  assertGatewaySigner(context);
  const source = gatewayChainByKey(sourceKey);
  if (!source) throw new EarnAccessError("GATEWAY_CHAIN_UNSUPPORTED", "Choose a supported Gateway testnet.", 400);
  if (amountMinor <= 0n) throw new EarnAccessError("INVALID_AMOUNT", "Enter a positive USDC amount.", 400);
  assertLiveAmount(mode, amountMinor.toString());
  await assertLiveReady(context, mode, "QUOTE");
  const wallet = context.wallet.address;
  let estimate;
  try { estimate = await estimateForwardedTransfer(buildArcTransferSpec({ source, depositor: wallet, recipient: wallet, valueMinor: amountMinor })); }
  catch (error) { throw new EarnAccessError(error instanceof GatewayApiError ? error.code : "GATEWAY_UNAVAILABLE", error instanceof Error ? error.message : "Circle Gateway is unavailable.", 503); }
  const [available, block] = await Promise.all([gatewayBalances(wallet).then((map) => map.get(source.domain) ?? 0n), arcClient.getBlockNumber()]);
  if (available < amountMinor + estimate.feeMinor) throw new EarnAccessError("GATEWAY_BALANCE_INSUFFICIENT", `Your Gateway balance on ${source.label} must cover the amount plus up to ${Number(estimate.feeMinor) / 1e6} USDC in Gateway and forwarding fees.`, 409);
  const handle = sealGatewayHandle({ kind: "MOVE_QUOTE", uid: context.userId, binding: context.binding, wallet: wallet.toLowerCase(), sourceKey, intent: digest(estimate.intent), startBlock: block.toString(), forwardingFee: estimate.forwardingFeeMinor.toString(), exp: Date.now() + QUOTE_TTL_MS });
  return moveView({ stage: "SIGN", handle, sourceKey, intent: estimate.intent, fee: estimate.feeMinor.toString(), forwardingFee: estimate.forwardingFeeMinor.toString(), transferId: null, mintTxHash: null, withTypedData: true, message: `Sign once in your wallet (free, no gas). Circle then mints ${Number(amountMinor) / 1e6} USDC to your own Arc wallet.` });
}

/** Verifies the wallet's EIP-712 signature for exactly the sealed intent, then hands it to Gateway once. */
export async function submitGatewayMove(context: Context, mode: ExecutionMode, handle: string, intentInput: unknown, signature: `0x${string}`): Promise<GatewayMove> {
  assertGatewaySigner(context);
  const sealed = openGatewayHandle(handle, quoteHandle); const intent = burnIntentSchema.safeParse(intentInput);
  if (!sealed || !intent.success || sealed.uid !== context.userId || sealed.binding !== context.binding || sealed.wallet !== context.wallet.address.toLowerCase() || sealed.intent !== digest(intent.data) || sealed.exp <= Date.now()) throw new EarnAccessError("GATEWAY_QUOTE_INVALID", "This transfer review expired or changed. Request a fresh one; nothing was sent.", 409);
  // Recipient is the session wallet itself: re-check it from the signed bytes, not from the client.
  if (fromBytes32(intent.data.spec.destinationRecipient) !== getAddress(context.wallet.address) || fromBytes32(intent.data.spec.sourceSigner) !== getAddress(context.wallet.address)) throw new EarnAccessError("GATEWAY_QUOTE_INVALID", "The transfer must mint to your own wallet.", 409);
  await verifyIntentSignature(intent.data, signature, context.wallet.address);
  await assertLiveReady(context, mode, "START");
  let transferId: string;
  try { transferId = await submitForwardedTransfer(intent.data, signature); }
  catch (error) { throw new EarnAccessError(error instanceof GatewayApiError ? error.code : "GATEWAY_UNAVAILABLE", error instanceof GatewayApiError && error.definitive ? `${error.message} Nothing was sent.` : "Circle Gateway did not confirm receipt. Check your Arc balance before trying again; the same signature cannot mint twice.", 409); }
  const fee = intent.data.maxFee;
  const next = sealGatewayHandle({ kind: "MOVE_SUBMITTED", uid: context.userId, wallet: context.wallet.address.toLowerCase(), sourceKey: sealed.sourceKey, intent: intent.data, startBlock: sealed.startBlock, transferId, fee, forwardingFee: sealed.forwardingFee });
  return moveView({ stage: "SUBMITTED", handle: next, sourceKey: sealed.sourceKey, intent: intent.data, fee, forwardingFee: sealed.forwardingFee, transferId, mintTxHash: null, message: "Circle Gateway accepted the transfer. Waiting for the mint on Arc." });
}

/** Status only: reads Gateway, then proves the Arc mint itself before reporting success. */
export async function gatewayMoveStatus(context: Context, handle: string): Promise<GatewayMove> {
  const sealed = openGatewayHandle(handle, submittedHandle);
  if (!sealed || sealed.uid !== context.userId) throw new EarnAccessError("GATEWAY_HANDLE_INVALID", "This transfer is not available in this session.", 404);
  const base = { handle, sourceKey: sealed.sourceKey, intent: sealed.intent, fee: sealed.fee, forwardingFee: sealed.forwardingFee, transferId: sealed.transferId };
  let status;
  try { status = await gatewayTransferStatus(sealed.transferId); }
  catch { return moveView({ ...base, stage: "SUBMITTED", mintTxHash: null, message: "Circle Gateway status is temporarily unavailable. Check again shortly." }); }
  if (status.transactionHash) {
    try {
      await verifyGatewayMint(status.transactionHash as `0x${string}`, { recipient: sealed.wallet, valueMinor: BigInt(sealed.intent.spec.value), afterBlock: BigInt(sealed.startBlock) });
      return moveView({ ...base, stage: "CONFIRMED", mintTxHash: status.transactionHash, message: "Verified on Arc: the USDC was minted to your wallet." });
    } catch { return moveView({ ...base, stage: "SUBMITTED", mintTxHash: status.transactionHash, message: "Mint reported; waiting for a verifiable Arc receipt." }); }
  }
  if (status.status === "failed" || status.status === "expired") return moveView({ ...base, stage: "FAILED", mintTxHash: null, message: `Circle Gateway reports this transfer as ${status.status}${status.forwardingDetails?.failureReason ? ` (${status.forwardingDetails.failureReason.slice(0, 120)})` : ""}. Your Gateway balance is not spent by an unminted transfer.` });
  return moveView({ ...base, stage: "SUBMITTED", mintTxHash: null, message: "Waiting for Circle to mint on Arc." });
}

/** Dev test signer: true only for this session's sealed, unexpired move of exactly this intent to the signer itself. */
export function isSealedMoveFor(context: Context, handle: string, intent: BurnIntent) {
  const sealed = openGatewayHandle(handle, quoteHandle);
  return Boolean(sealed && sealed.uid === context.userId && sealed.binding === context.binding && sealed.wallet === context.wallet.address.toLowerCase() && sealed.intent === digest(intent) && sealed.exp > Date.now() && fromBytes32(intent.spec.destinationRecipient) === getAddress(context.wallet.address));
}
