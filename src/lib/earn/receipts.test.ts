import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, type TransactionReceipt } from "viem";
import { ARC_USDC_SYSTEM_EMITTER, verifyApprovalReceipt, verifyEarnReceipt } from "./receipts";
import type { EarnQuote } from "./models";
const wallet = "0x0000000000000000000000000000000000000001";
const vault = "0x0000000000000000000000000000000000000002";
const stranger = "0x0000000000000000000000000000000000000003";
const abi = parseAbi(["event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)", "event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)", "event Transfer(address indexed from,address indexed to,uint256 value)", "event Approval(address indexed owner,address indexed spender,uint256 value)", "function approve(address spender,uint256 amount) returns (bool)"]);
const quote = { walletAddress: wallet, vaultAddress: vault, operation: "DEPOSIT", amount: { minorUnits: "1000000" } } as EarnQuote;
function receipt(owner: `0x${string}` = wallet, amount = 1_000_000n, address: `0x${string}` = vault) {
  return { status: "success", logs: [{ address, topics: encodeEventTopics({ abi, eventName: "Deposit", args: { sender: wallet, owner } }), data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [amount, 100n]) }] } as unknown as TransactionReceipt;
}
describe("Arc Earn receipt evidence", () => {
  it("requires exact withdrawal assets and scales native system transfers to 18 decimals", () => {
    const withdrawal = { ...quote, operation: "WITHDRAW" as const };
    const value = { status: "success", logs: [{ address: vault, topics: encodeEventTopics({ abi, eventName: "Withdraw", args: { sender: wallet, owner: wallet, receiver: stranger } }), data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1000000n, 100n]) }, { address: ARC_USDC_SYSTEM_EMITTER, topics: encodeEventTopics({ abi, eventName: "Transfer", args: { from: stranger, to: wallet } }), data: encodeAbiParameters([{ type: "uint256" }], [1000000n]) }] } as unknown as TransactionReceipt;
    expect(() => verifyEarnReceipt(value, withdrawal)).toThrow();
    value.logs[1].data = encodeAbiParameters([{ type: "uint256" }], [1000000000000000000n]);
    expect(() => verifyEarnReceipt(value, withdrawal)).not.toThrow();
    expect(() => verifyEarnReceipt({ ...value, logs: [value.logs[1]] }, withdrawal)).toThrow();
  });
  it("accepts the selected vault, exact assets and receiving wallet", () => { expect(() => verifyEarnReceipt(receipt(), quote)).not.toThrow(); });
  it("rejects unrelated receipts, wrong amounts, wallets and vaults", () => {
    for (const value of [receipt(stranger), receipt(wallet, 1n), receipt(wallet, 1_000_000n, stranger), { ...receipt(), status: "reverted" as const }, { ...receipt(), logs: [] }]) expect(() => verifyEarnReceipt(value, quote)).toThrow();
  });
  it("correlates smart-account approval receipts to owner, spender and exact allowance", () => {
    const call = { to: vault, data: encodeFunctionData({ abi, functionName: "approve", args: [stranger, 100n] }) } as const;
    const value = { status: "success", logs: [{ address: vault, topics: encodeEventTopics({ abi, eventName: "Approval", args: { owner: wallet, spender: stranger } }), data: encodeAbiParameters([{ type: "uint256" }], [100n]) }] } as unknown as TransactionReceipt;
    expect(() => verifyApprovalReceipt(value, call, wallet)).not.toThrow(); expect(() => verifyApprovalReceipt(value, call, stranger)).toThrow();
  });
});
