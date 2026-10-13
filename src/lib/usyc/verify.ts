import "server-only";
import { TransactionReceiptNotFoundError, decodeEventLog, getAddress, zeroAddress, type Abi, type Log } from "viem";
import { arcClient } from "@/lib/earn/gateway";
import { USYC_USDC, poolAbi, usdcAbi, usycPoolAddress } from "./constants";
import { poolNotDeployed, usycUnavailable } from "./errors";
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
 * Read-only: what did this transaction do for `wallet` in Hodd's USYC pool? The receipt must show the exact effect,
 * not just success.
 *  APPROVE  USDC `Approval(wallet → pool)`, equal to `amount`.
 *  DEPOSIT  the pool's `UsycSubscribed` for the wallet (as depositor and receiver), the USDC paid in by the wallet
 *           and the matching share mint (0x0 → wallet). `amount` is the USDC deposited.
 *  WITHDRAW the pool's `UsycRedeemed` for the wallet, the matching share burn (wallet → 0x0) and the USDC paid by
 *           the pool to the wallet. `amount` is the shares redeemed.
 * The signing account may be a smart account, so the transaction's own `from`/`to` are not used.
 * A transaction that succeeded but did something else is UNRELATED; an unknown hash is PENDING.
 */
export async function verifyUsycTransaction(input: { wallet: string; step: UsycStage; txHash: string; amount?: bigint }, pool = usycPoolAddress()): Promise<UsycVerification> {
  if (!pool) throw poolNotDeployed();
  const wallet = getAddress(input.wallet), txHash = input.txHash.toLowerCase() as `0x${string}`, base = { step: input.step, txHash } as const;
  let receipt;
  try { receipt = await arcClient.getTransactionReceipt({ hash: txHash }); }
  catch (error) { if (error instanceof TransactionReceiptNotFoundError) return { ...base, status: "PENDING" }; throw usycUnavailable(); }
  if (receipt.status !== "success") return { ...base, status: "REVERTED" };
  const unrelated = { ...base, status: "UNRELATED" } as const;
  const logs = receipt.logs as readonly Log[];
  const vault = decoded(logs, pool, poolAbi), cash = decoded(logs, USYC_USDC, usdcAbi);
  const sum = (events: typeof vault, test: (args: Record<string, unknown>) => boolean) => events.filter((event) => event.eventName === "Transfer" && test(event.args)).reduce((total, event) => total + (event.args.value as bigint), 0n);

  if (input.step === "APPROVE") {
    const approvals = cash.filter((event) => event.eventName === "Approval" && same(String(event.args.owner), wallet) && same(String(event.args.spender), pool));
    const last = approvals.at(-1)?.args.value as bigint | undefined;
    // An approval is only the one we asked for when it is exact; a larger or smaller allowance is not "approved".
    return last !== undefined && (input.amount === undefined || last === input.amount) ? { ...base, status: "CONFIRMED" } : unrelated;
  }
  if (input.step === "DEPOSIT") {
    const subscribed = vault.find((event) => event.eventName === "UsycSubscribed" && same(String(event.args.user), wallet) && same(String(event.args.receiver), wallet));
    if (!subscribed) return unrelated;
    const usdcIn = subscribed.args.usdcIn as bigint, shares = subscribed.args.shares as bigint;
    const paidIn = sum(cash, (args) => same(String(args.from), wallet) && same(String(args.to), pool));
    const minted = sum(vault, (args) => same(String(args.from), zeroAddress) && same(String(args.to), wallet));
    if (shares <= 0n || minted !== shares || paidIn !== usdcIn || (input.amount !== undefined && usdcIn !== input.amount)) return unrelated;
    return { ...base, status: "CONFIRMED", depositedUsdcMinor: usdcIn.toString(), receivedShares: minted.toString() };
  }
  const redeemed = vault.find((event) => event.eventName === "UsycRedeemed" && same(String(event.args.user), wallet));
  if (!redeemed) return unrelated;
  const shares = redeemed.args.shares as bigint, usdcOut = redeemed.args.usdcOut as bigint;
  const burned = sum(vault, (args) => same(String(args.from), wallet) && same(String(args.to), zeroAddress));
  const paid = sum(cash, (args) => same(String(args.from), pool) && same(String(args.to), wallet));
  if (shares <= 0n || burned !== shares || usdcOut <= 0n || paid !== usdcOut || (input.amount !== undefined && shares !== input.amount)) return unrelated;
  return { ...base, status: "CONFIRMED", burnedShares: burned.toString(), receivedUsdcMinor: paid.toString() };
}
