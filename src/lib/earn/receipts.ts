import { decodeEventLog, decodeFunctionData, parseAbi, type TransactionReceipt } from "viem";
import type { EvmCall } from "@circle-fin/adapter-viem-v2/next";
import type { EarnQuote } from "./models";
import { ARC_TESTNET_USDC } from "./allowlist";
export const ARC_USDC_SYSTEM_EMITTER = "0xfffffffffffffffffffffffffffffffffffffffe";

const abi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function increaseAllowance(address spender,uint256 addedValue) returns (bool)",
  "event Approval(address indexed owner,address indexed spender,uint256 value)",
  "event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)",
  "event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)",
  "event Transfer(address indexed from,address indexed to,uint256 value)",
]);
export function verifyApprovalReceipt(receipt: TransactionReceipt, call: EvmCall, walletAddress: string) {
  if (receipt.status !== "success" || !call.data) throw new Error("APPROVAL_NOT_VERIFIED");
  const expected = decodeFunctionData({ abi, data: call.data });
  if (expected.functionName !== "approve" && expected.functionName !== "increaseAllowance") throw new Error("APPROVAL_NOT_VERIFIED");
  const valid = receipt.logs.some((log) => {
    if (log.address.toLowerCase() !== call.to.toLowerCase()) return false;
    try { const event = decodeEventLog({ abi, data: log.data, topics: log.topics }); return event.eventName === "Approval" && event.args.owner.toLowerCase() === walletAddress.toLowerCase() && event.args.spender.toLowerCase() === expected.args[0].toLowerCase() && (expected.functionName === "approve" ? event.args.value === expected.args[1] : event.args.value >= expected.args[1]); }
    catch { return false; }
  });
  if (!valid) throw new Error("APPROVAL_NOT_VERIFIED");
}
/** A hash alone, including a successful unrelated transaction, is never completion proof. */
export function verifyEarnReceipt(receipt: TransactionReceipt, quote: EarnQuote) {
  if (receipt.status !== "success") throw new Error("RECEIPT_REVERTED");
  const address = quote.walletAddress.toLowerCase();
  let operation = false; let received = false;
  // Receiver -> exact assets of this wallet's vault withdrawal.
  const withdrawalReceivers = new Map<string, bigint>();
  // Redeem-all burns every share; the vault may return a unit more than quoted (rounding),
  // never less. Partial withdrawals must match exactly.
  const quoted = BigInt(quote.amount.minorUnits);
  const expectedAssets = (assets: bigint) => quote.operation === "REDEEM_ALL" ? assets >= quoted : assets === quoted;
  // Earn Kit routers pull the wallet's shares and withdraw as owner. Accept a
  // router owner only when this wallet's net share transfer to it equals
  // exactly the shares burned by that withdrawal.
  const vault = quote.vaultAddress.toLowerCase();
  const shareTransfers = receipt.logs.flatMap((log) => { if (log.address.toLowerCase() !== vault) return []; try { const event = decodeEventLog({ abi, data: log.data, topics: log.topics }); return event.eventName === "Transfer" ? [event.args] : []; } catch { return []; } });
  const ownedBy = (owner: string, shares: bigint) => owner.toLowerCase() === address || shares > 0n && shareTransfers.reduce((net, item) => net + (item.from.toLowerCase() === address && item.to.toLowerCase() === owner.toLowerCase() ? item.value : item.from.toLowerCase() === owner.toLowerCase() && item.to.toLowerCase() === address ? -item.value : 0n), 0n) === shares;
  // Router withdrawals can receive assets first and then forward them. Bind the
  // forwarding leg to the receiver of this wallet's exact vault withdrawal.
  if (quote.operation !== "DEPOSIT") for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== quote.vaultAddress.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (event.eventName === "Withdraw" && ownedBy(event.args.owner, event.args.shares) && expectedAssets(event.args.assets)) withdrawalReceivers.set(event.args.receiver.toLowerCase(), event.args.assets);
    } catch { /* unrelated event */ }
  }
  for (const log of receipt.logs) {
    try {
      const event = decodeEventLog({ abi, data: log.data, topics: log.topics });
      if (log.address.toLowerCase() === quote.vaultAddress.toLowerCase()) {
        if (event.eventName === "Deposit" && quote.operation === "DEPOSIT" && event.args.assets === BigInt(quote.amount.minorUnits) && event.args.owner.toLowerCase() === address) { operation = true; received = true; }
        if (event.eventName === "Withdraw" && quote.operation !== "DEPOSIT" && expectedAssets(event.args.assets) && ownedBy(event.args.owner, event.args.shares)) { operation = true; if (event.args.receiver.toLowerCase() === address) received = true; }
        if (event.eventName === "Transfer" && quote.operation === "DEPOSIT" && event.args.to.toLowerCase() === address && event.args.value > 0n) received = true;
      }
      if (log.address.toLowerCase() === ARC_TESTNET_USDC.toLowerCase() && event.eventName === "Transfer" && quote.operation !== "DEPOSIT" && withdrawalReceivers.get(event.args.from.toLowerCase()) === event.args.value && event.args.to.toLowerCase() === address) received = true;
      // Alternative evidence, not an additional balance: system logs use 18 decimals.
      if (log.address.toLowerCase() === ARC_USDC_SYSTEM_EMITTER && event.eventName === "Transfer" && quote.operation !== "DEPOSIT" && (withdrawalReceivers.get(event.args.from.toLowerCase()) ?? -1n) * 10n ** 12n === event.args.value && event.args.to.toLowerCase() === address) received = true;
    } catch { /* unrelated logs do not count as evidence */ }
  }
  if (quote.operation === "DEPOSIT" && !operation) operation = received = routedDepositVerified(receipt, quote);
  if (!operation || !received) throw new Error("EARN_RECEIPT_NOT_VERIFIED");
}

/**
 * Earn Kit deposits through a router: wallet USDC -> router, router deposits as
 * owner, then forwards the minted shares. Accept only the fully bound chain:
 * exact USDC from this wallet to the router, the router's exact-asset vault
 * Deposit, and exactly those shares from the router to this wallet.
 */
function routedDepositVerified(receipt: TransactionReceipt, quote: EarnQuote) {
  const wallet = quote.walletAddress.toLowerCase(); const vault = quote.vaultAddress.toLowerCase(); const assets = BigInt(quote.amount.minorUnits);
  const events = receipt.logs.flatMap((log) => { try { return [{ address: log.address.toLowerCase(), event: decodeEventLog({ abi, data: log.data, topics: log.topics }) }]; } catch { return []; } });
  return events.some(({ address, event }) => {
    if (address !== vault || event.eventName !== "Deposit" || event.args.assets !== assets) return false;
    const router = event.args.owner.toLowerCase(); const shares = event.args.shares;
    if (router === wallet || event.args.sender.toLowerCase() !== router || shares <= 0n) return false;
    const funded = events.some((item) => item.address === ARC_TESTNET_USDC.toLowerCase() && item.event.eventName === "Transfer" && item.event.args.from.toLowerCase() === wallet && item.event.args.to.toLowerCase() === router && item.event.args.value === assets);
    const forwarded = events.some((item) => item.address === vault && item.event.eventName === "Transfer" && item.event.args.from.toLowerCase() === router && item.event.args.to.toLowerCase() === wallet && item.event.args.value === shares);
    return funded && forwarded;
  });
}
