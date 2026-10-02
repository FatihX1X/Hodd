import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, type TransactionReceipt } from "viem";
import { ARC_TESTNET_USDC } from "@/lib/earn/allowlist";
import type { PaymentProposal } from "./models";
import { verifyPaymentReceipt } from "./receipts";
const wallet = "0x0000000000000000000000000000000000000001";
const recipient = "0x0000000000000000000000000000000000000002";
const proposal = { wallet: { address: wallet }, recipientAddress: recipient, amount: { minorUnits: "1000000" }, startBlock: "10" } as PaymentProposal;
const receipt = (): TransactionReceipt => ({ status: "success", blockNumber: 11n, gasUsed: 21000n, effectiveGasPrice: 20000000000n, logs: [{ address: ARC_TESTNET_USDC, logIndex: 1, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: wallet, to: recipient } }), data: encodeAbiParameters([{ type: "uint256" }], [1000000n]) }] }) as TransactionReceipt;
describe("canonical USDC payment receipt", () => {
  it("requires exact transfer evidence and distinguishes network fees from sponsored wallet debits", () => {
    expect(verifyPaymentReceipt(receipt(), proposal)).toEqual({ blockNumber: "11", logIndex: 1, networkFee: { currency: "USDC", decimals: 6, minorUnits: "420" } });
  });
  it("rejects failed, stale, wrong recipient, wrong amount and noncanonical logs", () => {
    const wrongAmount = receipt(); wrongAmount.logs[0].data = encodeAbiParameters([{ type: "uint256" }], [1n]);
    const wrongContract = receipt(); wrongContract.logs[0].address = recipient;
    for (const value of [wrongAmount, wrongContract, { ...receipt(), status: "reverted" as const }, { ...receipt(), blockNumber: 10n }, { ...receipt(), logs: [] }]) expect(() => verifyPaymentReceipt(value, proposal)).toThrow();
    expect(() => verifyPaymentReceipt(receipt(), { ...proposal, recipientAddress: wallet })).toThrow();
  });
});
