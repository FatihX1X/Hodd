// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, type TransactionReceipt } from "viem";
import { entryPoint07Abi } from "viem/account-abstraction";
import type { PaymentProposal } from "./models";
import { ARC_GAS_STATION_PAYMASTER } from "@/lib/wallet/fee-quote";
const fake = vi.hoisted(() => ({ operation: vi.fn(), receipt: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/wallet/modular-server", () => ({ modularReadClient: async () => ({ account: { entryPoint: { address: "0x0000000000000000000000000000000000000004" } }, bundler: { getUserOperation: fake.operation, getUserOperationReceipt: fake.receipt } }) }));
import { verifyPaymentUserOperation, resolvePaymentUserOperation } from "./user-operation";
const userHash = `0x${"1".repeat(64)}` as const; const txHash = `0x${"2".repeat(64)}` as const;
const entryPoint = "0x0000000000000000000000000000000000000004";
const wallet = "0x0000000000000000000000000000000000000001";
const op = { sender: wallet, nonce: "0", callData: "0x1234", callGasLimit: "10000", verificationGasLimit: "10000", preVerificationGas: "10000", maxFeePerGas: "20000000000", maxPriorityFeePerGas: "1000000000", paymaster: ARC_GAS_STATION_PAYMASTER, paymasterData: "0xabcd", paymasterVerificationGasLimit: "10000", paymasterPostOpGasLimit: "10000" };
const proposal = { wallet: { provider: "CIRCLE_MODULAR", address: wallet }, startBlock: "10", gasBudgetWei: "1000000000000000", feeQuote: { userOperation: op } } as PaymentProposal;
const actual = () => ({ transactionHash: txHash, entryPoint, userOperation: { ...op, nonce: 0n, callGasLimit: 10000n, verificationGasLimit: 10000n, preVerificationGas: 10000n, maxFeePerGas: 20000000000n, maxPriorityFeePerGas: 1000000000n, paymasterVerificationGasLimit: 10000n, paymasterPostOpGasLimit: 10000n } });
const receipt = (success = true) => ({ status: "success", blockNumber: 11n, transactionHash: txHash, logs: [{ address: entryPoint, topics: encodeEventTopics({ abi: entryPoint07Abi, eventName: "UserOperationEvent", args: { userOpHash: userHash, sender: wallet, paymaster: ARC_GAS_STATION_PAYMASTER } }), data: encodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], [0n, success, 100000000000000n, 10000n]) }] }) as unknown as TransactionReceipt;
beforeEach(() => { vi.clearAllMocks(); fake.operation.mockResolvedValue(actual()); fake.receipt.mockResolvedValue({ receipt: { transactionHash: txHash } }); });
describe("server UserOperation receipt binding", () => {
  it("verifies the actual operation, not just an outer successful transaction", async () => {
    expect(await verifyPaymentUserOperation(receipt(), proposal, userHash)).toMatchObject({ success: true, userOperationHash: userHash });
    expect(await verifyPaymentUserOperation(receipt(false), proposal, userHash)).toMatchObject({ success: false });
    expect(await resolvePaymentUserOperation(proposal, userHash)).toBe(txHash);
    expect(fake.receipt).toHaveBeenCalledWith({ hash: userHash });
  });
  it("rejects wrong operation, sender, calldata, paymaster, nonce, fees, entry point and transaction", async () => {
    for (const changes of [{ callData: "0xabcd" }, { sender: entryPoint }, { paymaster: entryPoint }, { nonce: 1n }, { callGasLimit: 10001n }, { verificationGasLimit: undefined }, { paymasterData: "0x00" }]) {
      fake.operation.mockResolvedValue({ ...actual(), userOperation: { ...actual().userOperation, ...changes } }); await expect(verifyPaymentUserOperation(receipt(), proposal, userHash)).rejects.toThrow();
    }
    fake.operation.mockResolvedValue({ ...actual(), transactionHash: userHash }); await expect(verifyPaymentUserOperation(receipt(), proposal, userHash)).rejects.toThrow();
    fake.operation.mockResolvedValue(actual()); await expect(verifyPaymentUserOperation(receipt(), proposal, txHash)).rejects.toThrow("EVENT_NOT_VERIFIED");
    await expect(verifyPaymentUserOperation({ ...receipt(), logs: [] }, proposal)).rejects.toThrow();
    await expect(verifyPaymentUserOperation({ ...receipt(), blockNumber: 10n }, proposal)).rejects.toThrow();
  });
});
