import { decodeEventLog, decodeFunctionData, parseAbi, type TransactionReceipt } from "viem";
import type { EvmCall } from "@circle-fin/adapter-viem-v2/next";
import type { EarnQuote } from "./models";
import { ARC_TESTNET_USDC } from "./allowlist";
export const ARC_USDC_SYSTEM_EMITTER = "0xfffffffffffffffffffffffffffffffffffffffe";

const abi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
  "event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)",
  "event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
export function verifyApprovalReceipt(receipt: TransactionReceipt, call: EvmCall, walletAddress: string) {
  if (receipt.status !== "success" || !call.data) throw new Error("APPROVAL_NOT_VERIFIED");
  const expected = decodeFunctionData({ abi, data: call.data });
  if (expected.functionName !== "approve") throw new Error("APPROVAL_NOT_VERIFIED");
  const valid = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== call.to.toLowerCase()) return false;
    try { const event = decodeEventLog({ abi, data: log.data, topics: log.topics }); return event.eventName === "Approval" && event.args.owner.toLowerCase() === walletAddress.toLowerCase() && event.args.spender.toLowerCase() === expected.args[0].toLowerCase() && event.args.value === expected.args[1]; }
    catch { return false; }
  });
  if (!valid) throw new Error("APPROVAL_NOT_VERIFIED");
}
/** A hash alone, including a successful unrelated transaction, is never completion proof. */
export function verifyEarnReceipt(receipt: TransactionReceipt, quote: EarnQuote) {
  if (receipt.status !== "success") throw new Error("RECEIPT_REVERTED");
  const address = quote.walletAddress.toLowerCase();
  let operation = false; let received = false;
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (log.address.toLowerCase() === quote.vaultAddress.toLowerCase()) {
        if (event.eventName === "Deposit" && quote.operation === "DEPOSIT" && event.args.assets === BigInt(quote.amount.minorUnits)) { operation = true; if (event.args.owner.toLowerCase() === address) received = true; }
        if (event.eventName === "Withdraw" && quote.operation !== "DEPOSIT" && event.args.assets === BigInt(quote.amount.minorUnits)) { operation = true; if (event.args.receiver.toLowerCase() === address) received = true; }
        if (event.eventName === "Transfer" && quote.operation === "DEPOSIT" && event.args.to.toLowerCase() === address && event.args.value > 0n) received = true;
      }
      if (log.address.toLowerCase() === ARC_TESTNET_USDC.toLowerCase() && event.eventName === "Transfer" && quote.operation !== "DEPOSIT" && event.args.to.toLowerCase() === address && event.args.value >= BigInt(quote.amount.minorUnits)) received = true;
      // Alternative evidence, not an additional balance: system logs use 18 decimals.
      if (log.address.toLowerCase() === ARC_USDC_SYSTEM_EMITTER && event.eventName === "Transfer" && quote.operation !== "DEPOSIT" && event.args.to.toLowerCase() === address && event.args.value >= BigInt(quote.amount.minorUnits) * 10n ** 12n) received = true;
    } catch { /* unrelated logs do not count as evidence */ }
  }
  if (!operation || !received) throw new Error("EARN_RECEIPT_NOT_VERIFIED");
}
