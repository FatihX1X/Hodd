import "server-only";
import { decodeEventLog, erc20Abi, getAddress, parseAbiItem, zeroAddress, type TransactionReceipt } from "viem";
import { arcClient } from "@/lib/earn/gateway";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
import { GATEWAY_MINTER } from "./chains";

export type GatewayMintEvidence = Readonly<{ blockNumber: string; logIndex: number; networkFee: { currency: "USDC"; decimals: 6; minorUnits: "0" } }>;

/**
 * A Gateway mint on Arc is proven only by a successful transaction to the
 * GatewayMinter that emits canonical USDC Transfer(0x0 → recipient, exact value).
 * The forwarder pays the Arc gas, so the payer's network fee here is zero.
 */
export function verifyGatewayMintReceipt(receipt: TransactionReceipt, transactionTo: string | null, expected: { recipient: string; valueMinor: bigint; afterBlock: bigint }): GatewayMintEvidence {
  if (receipt.status !== "success" || receipt.blockNumber <= expected.afterBlock) throw new Error("GATEWAY_MINT_NOT_VERIFIED");
  if (!transactionTo || getAddress(transactionTo) !== GATEWAY_MINTER) throw new Error("GATEWAY_MINT_WRONG_CONTRACT");
  const recipient = getAddress(expected.recipient);
  const log = receipt.logs.find((item) => {
    if (getAddress(item.address) !== ARC_TESTNET_USDC) return false;
    try { const event = decodeEventLog({ abi: erc20Abi, topics: item.topics, data: item.data }); return event.eventName === "Transfer" && getAddress(event.args.from) === zeroAddress && getAddress(event.args.to) === recipient && event.args.value === expected.valueMinor; }
    catch { return false; }
  });
  if (!log || log.logIndex === null) throw new Error("GATEWAY_MINT_TRANSFER_NOT_VERIFIED");
  return { blockNumber: receipt.blockNumber.toString(), logIndex: log.logIndex, networkFee: { currency: "USDC", decimals: 6, minorUnits: "0" } };
}

export async function verifyGatewayMint(hash: `0x${string}`, expected: { recipient: string; valueMinor: bigint; afterBlock: bigint }) {
  if (await arcClient.getChainId() !== 5_042_002) throw new Error("WRONG_RECEIPT_CHAIN");
  const [receipt, transaction] = await Promise.all([arcClient.getTransactionReceipt({ hash }), arcClient.getTransaction({ hash })]);
  return verifyGatewayMintReceipt(receipt, transaction.to, expected);
}

const transferEvent = parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)");
const SCAN_CHUNK = 5_000n;

/** Searches Arc for a Gateway mint of exactly this value to this recipient since a block. */
export async function findGatewayMint(expected: { recipient: string; valueMinor: bigint; afterBlock: bigint }) {
  const head = await arcClient.getBlockNumber();
  for (let from = expected.afterBlock + 1n; from <= head; from += SCAN_CHUNK) {
    const to = from + SCAN_CHUNK - 1n < head ? from + SCAN_CHUNK - 1n : head;
    const logs = await arcClient.getLogs({ address: ARC_TESTNET_USDC, event: transferEvent, args: { from: zeroAddress, to: getAddress(expected.recipient) }, fromBlock: from, toBlock: to });
    for (const log of logs) {
      if (log.args.value !== expected.valueMinor || !log.transactionHash) continue;
      try { return { hash: log.transactionHash, evidence: await verifyGatewayMint(log.transactionHash, expected) }; } catch { /* not a Gateway mint */ }
    }
  }
  return null;
}
