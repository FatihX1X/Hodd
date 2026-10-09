import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, parseAbi, type TransactionReceipt } from "viem";
import { ARC_USDC_SYSTEM_EMITTER, verifyApprovalReceipt, verifyEarnReceipt } from "./receipts";
import type { EarnQuote } from "./models";
const wallet = "0x0000000000000000000000000000000000000001";
const vault = "0x0000000000000000000000000000000000000002";
const stranger = "0x0000000000000000000000000000000000000003";
const abi = parseAbi(["event Deposit(address indexed sender,address indexed owner,uint256 assets,uint256 shares)", "event Withdraw(address indexed sender,address indexed receiver,address indexed owner,uint256 assets,uint256 shares)", "event Transfer(address indexed from,address indexed to,uint256 value)", "event Approval(address indexed owner,address indexed spender,uint256 value)", "function approve(address spender,uint256 amount) returns (bool)", "function increaseAllowance(address spender,uint256 addedValue) returns (bool)"]);
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
  it("binds Earn Kit router deposits from wallet funding to forwarded shares", () => {
    const router = "0x0000000000000000000000000000000000000004"; const usdc = "0x3600000000000000000000000000000000000000";
    const transfer = (address: `0x${string}`, from: `0x${string}`, to: `0x${string}`, value: bigint) => ({ address, topics: encodeEventTopics({ abi, eventName: "Transfer", args: { from, to } }), data: encodeAbiParameters([{ type: "uint256" }], [value]) });
    const deposit = { address: vault, topics: encodeEventTopics({ abi, eventName: "Deposit", args: { sender: router, owner: router } }), data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [1_000_000n, 999n]) };
    const routed = (...logs: unknown[]) => ({ status: "success", logs }) as unknown as TransactionReceipt;
    const funded = transfer(usdc, wallet, router, 1_000_000n); const forwarded = transfer(vault, router, wallet, 999n);
    expect(() => verifyEarnReceipt(routed(funded, deposit, forwarded), quote)).not.toThrow();
    for (const value of [routed(deposit, forwarded), routed(funded, deposit), routed(funded, deposit, transfer(vault, router, wallet, 998n)), routed(funded, deposit, transfer(vault, router, stranger, 999n)), routed(transfer(usdc, stranger, router, 1_000_000n), deposit, forwarded), routed(transfer(usdc, wallet, router, 1n), deposit, forwarded)]) expect(() => verifyEarnReceipt(value, quote)).toThrow();
  });
  it("binds Earn Kit router withdrawals to the wallet's exact share transfer", () => {
    const router = "0x0000000000000000000000000000000000000004"; const usdc = "0x3600000000000000000000000000000000000000";
    const withdrawal = { ...quote, operation: "WITHDRAW" as const, amount: { minorUnits: "500000" } } as EarnQuote;
    const transfer = (address: `0x${string}`, from: `0x${string}`, to: `0x${string}`, value: bigint) => ({ address, topics: encodeEventTopics({ abi, eventName: "Transfer", args: { from, to } }), data: encodeAbiParameters([{ type: "uint256" }], [value]) });
    const withdraw = (receiver: `0x${string}`, owner: `0x${string}` = router) => ({ address: vault, topics: encodeEventTopics({ abi, eventName: "Withdraw", args: { sender: router, receiver, owner } }), data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [500_000n, 499n]) });
    const routed = (...logs: unknown[]) => ({ status: "success", logs }) as unknown as TransactionReceipt;
    const pulled = transfer(vault, wallet, router, 499n);
    expect(() => verifyEarnReceipt(routed(pulled, withdraw(wallet)), withdrawal)).not.toThrow();
    expect(() => verifyEarnReceipt(routed(pulled, withdraw(router), transfer(usdc, router, wallet, 500_000n)), withdrawal)).not.toThrow();
    for (const value of [routed(withdraw(wallet)), routed(transfer(vault, wallet, router, 498n), withdraw(wallet)), routed(transfer(vault, stranger, router, 499n), withdraw(wallet)), routed(pulled, withdraw(stranger)), routed(pulled, withdraw(router), transfer(usdc, router, stranger, 500_000n))]) expect(() => verifyEarnReceipt(value, withdrawal)).toThrow();
  });
  it("accepts a redeem-all rounding unit above the quote, bound to the forwarded assets", () => {
    const router = "0x0000000000000000000000000000000000000004"; const usdc = "0x3600000000000000000000000000000000000000";
    const redeem = { ...quote, operation: "REDEEM_ALL" as const, amount: { minorUnits: "750121" } } as EarnQuote;
    const transfer = (address: `0x${string}`, from: `0x${string}`, to: `0x${string}`, value: bigint) => ({ address, topics: encodeEventTopics({ abi, eventName: "Transfer", args: { from, to } }), data: encodeAbiParameters([{ type: "uint256" }], [value]) });
    const withdraw = (assets: bigint) => ({ address: vault, topics: encodeEventTopics({ abi, eventName: "Withdraw", args: { sender: router, receiver: router, owner: router } }), data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [assets, 700n]) });
    const routed = (...logs: unknown[]) => ({ status: "success", logs }) as unknown as TransactionReceipt;
    const pulled = transfer(vault, wallet, router, 700n);
    expect(() => verifyEarnReceipt(routed(pulled, withdraw(750_122n), transfer(usdc, router, wallet, 750_122n)), redeem)).not.toThrow();
    // Never less than quoted, and the forwarded leg must equal the withdrawn assets.
    for (const value of [routed(pulled, withdraw(750_120n), transfer(usdc, router, wallet, 750_120n)), routed(pulled, withdraw(750_122n), transfer(usdc, router, wallet, 750_121n))]) expect(() => verifyEarnReceipt(value, redeem)).toThrow();
    // A partial withdrawal still requires the exact amount.
    expect(() => verifyEarnReceipt(routed(pulled, withdraw(750_122n), transfer(usdc, router, wallet, 750_122n)), { ...redeem, operation: "WITHDRAW" })).toThrow();
  });
  it("correlates smart-account approval receipts to owner, spender and exact allowance", () => {
    const call = { to: vault, data: encodeFunctionData({ abi, functionName: "approve", args: [stranger, 100n] }) } as const;
    const value = { status: "success", logs: [{ address: vault, topics: encodeEventTopics({ abi, eventName: "Approval", args: { owner: wallet, spender: stranger } }), data: encodeAbiParameters([{ type: "uint256" }], [100n]) }] } as unknown as TransactionReceipt;
    expect(() => verifyApprovalReceipt(value, call, wallet)).not.toThrow(); expect(() => verifyApprovalReceipt(value, call, stranger)).toThrow();
  });
  it("recognizes a USDC increaseAllowance receipt with the resulting allowance", () => {
    const call = { to: vault, data: encodeFunctionData({ abi, functionName: "increaseAllowance", args: [stranger, 100n] }) } as const;
    const value = { status: "success", logs: [{ address: vault, topics: encodeEventTopics({ abi, eventName: "Approval", args: { owner: wallet, spender: stranger } }), data: encodeAbiParameters([{ type: "uint256" }], [101n]) }] } as unknown as TransactionReceipt;
    expect(() => verifyApprovalReceipt(value, call, wallet)).not.toThrow();
    value.logs[0].data = encodeAbiParameters([{ type: "uint256" }], [99n]);
    expect(() => verifyApprovalReceipt(value, call, wallet)).toThrow();
  });
});
