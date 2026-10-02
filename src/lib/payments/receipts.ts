import { decodeEventLog, erc20Abi, type TransactionReceipt } from "viem";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
import { nativeWeiToUsdcCeil } from "@/lib/earn/money";
import type { PaymentProposal } from "./models";
export function verifyPaymentReceipt(receipt: TransactionReceipt, proposal: PaymentProposal) {
  if (receipt.status !== "success" || receipt.blockNumber <= BigInt(proposal.startBlock)) throw new Error("PAYMENT_RECEIPT_NOT_VERIFIED");
  // ERC-20 evidence only: never add Arc native/system events to the same transfer.
  const log = receipt.logs.find((item) => {
    if (item.address.toLowerCase() !== ARC_TESTNET_USDC.toLowerCase()) return false;
    try { const event = decodeEventLog({ abi: erc20Abi, topics: item.topics, data: item.data }); return event.eventName === "Transfer" && event.args.from.toLowerCase() === proposal.wallet.address.toLowerCase() && event.args.to.toLowerCase() === proposal.recipientAddress.toLowerCase() && event.args.value === BigInt(proposal.amount.minorUnits); } catch { return false; }
  });
  if (!log || log.logIndex === null) throw new Error("PAYMENT_TRANSFER_NOT_VERIFIED");
  // This is the transaction's network fee, not necessarily a sponsored wallet's debit.
  const networkFee = nativeWeiToUsdcCeil((receipt.gasUsed * receipt.effectiveGasPrice).toString());
  return { blockNumber: receipt.blockNumber.toString(), logIndex: log.logIndex, networkFee };
}
