import "server-only";
import { TransactionReceiptNotFoundError, decodeEventLog, getAddress, zeroAddress, type Abi, type Log } from "viem";
import { arcClient } from "@/lib/earn/gateway";
import { USYC_TELLER, USYC_TOKEN, USYC_USDC, tellerAbi, usdcAbi, usycTokenAbi } from "./constants";
import { usycUnavailable } from "./errors";
import type { UsycStage, UsycVerification } from "./models";

const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

function decoded(logs: readonly Log[], address: string, abi: Abi) {
  const events: { eventName: string; args: Record<string, unknown> }[] = [];
  for (const log of logs) {
    if (!same(log.address, address)) continue;
    try { const event = decodeEventLog({ abi, data: log.data, topics: log.topics as [`0x${string}`, ...`0x${string}`[]] }); events.push({ eventName: String(event.eventName), args: (event.args ?? {}) as Record<string, unknown> }); }
    catch { /* another event of the same contract */ }
  }
  return events;
}

/**
 * Read-only: what did this transaction do for `wallet`? The receipt must show the exact effect, not just success.
 *  APPROVE   USDC `Approval(wallet → Teller)`, equal to `amount`.
 *  SUBSCRIBE the Teller's `Subscribe` for the wallet and the matching USYC mint (0x0 → wallet).
 *  REDEEM    the Teller's `Redeem` for the wallet, the matching USYC burn (wallet → 0x0) and the USDC paid to the wallet.
 * The signing account may be a smart account, so the transaction's own `from`/`to` are not used.
 * A transaction that succeeded but did something else is UNRELATED; an unknown hash is PENDING.
 */
export async function verifyUsycTransaction(input: { wallet: string; step: UsycStage; txHash: string; amount?: bigint }): Promise<UsycVerification> {
  const wallet = getAddress(input.wallet), txHash = input.txHash.toLowerCase() as `0x${string}`, base = { step: input.step, txHash } as const;
  let receipt;
  try { receipt = await arcClient.getTransactionReceipt({ hash: txHash }); }
  catch (error) { if (error instanceof TransactionReceiptNotFoundError) return { ...base, status: "PENDING" }; throw usycUnavailable(); }
  if (receipt.status !== "success") return { ...base, status: "REVERTED" };
  const unrelated = { ...base, status: "UNRELATED" } as const;
  const logs = receipt.logs as readonly Log[];
  const teller = decoded(logs, USYC_TELLER, tellerAbi), usyc = decoded(logs, USYC_TOKEN, usycTokenAbi), cash = decoded(logs, USYC_USDC, usdcAbi);
  const sum = (events: typeof usyc, test: (args: Record<string, unknown>) => boolean) => events.filter((event) => event.eventName === "Transfer" && test(event.args)).reduce((total, event) => total + ((event.args.amount ?? event.args.value) as bigint), 0n);

  if (input.step === "APPROVE") {
    const approvals = cash.filter((event) => event.eventName === "Approval" && same(String(event.args.owner), wallet) && same(String(event.args.spender), USYC_TELLER));
    const last = approvals.at(-1)?.args.value as bigint | undefined;
    // An approval is only the one we asked for when it is exact; a larger or smaller allowance is not "approved".
    return last !== undefined && (input.amount === undefined || last === input.amount) ? { ...base, status: "CONFIRMED" } : unrelated;
  }
  if (input.step === "SUBSCRIBE") {
    const subscribe = teller.find((event) => event.eventName === "Subscribe" && same(String(event.args.from), wallet) && same(String(event.args.receiver), wallet));
    if (!subscribe) return unrelated;
    const shares = subscribe.args.shares as bigint, spent = (subscribe.args.assets as bigint) + (subscribe.args.fee as bigint);
    const minted = sum(usyc, (args) => same(String(args.from), zeroAddress) && same(String(args.to), wallet));
    if (shares <= 0n || minted !== shares || (input.amount !== undefined && spent !== input.amount)) return unrelated;
    return { ...base, status: "CONFIRMED", mintedSharesMinor: minted.toString(), spentAssetsMinor: spent.toString() };
  }
  const redeem = teller.find((event) => event.eventName === "Redeem" && same(String(event.args.from), wallet) && same(String(event.args.receiver), wallet));
  if (!redeem) return unrelated;
  const shares = redeem.args.shares as bigint, assets = redeem.args.assets as bigint;
  const burned = sum(usyc, (args) => same(String(args.from), wallet) && same(String(args.to), zeroAddress));
  const paid = sum(cash, (args) => !same(String(args.from), wallet) && same(String(args.to), wallet));
  if (shares <= 0n || burned !== shares || assets <= 0n || paid < assets || (input.amount !== undefined && shares !== input.amount)) return unrelated;
  return { ...base, status: "CONFIRMED", burnedSharesMinor: burned.toString(), receivedAssetsMinor: assets.toString() };
}
