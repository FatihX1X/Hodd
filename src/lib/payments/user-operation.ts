import "server-only";
import { decodeEventLog, type TransactionReceipt } from "viem";
import { entryPoint07Abi, type UserOperation } from "viem/account-abstraction";
import { modularReadClient } from "@/lib/wallet/modular-server";
import type { PaymentProposal } from "./models";

export async function resolvePaymentUserOperation(proposal: PaymentProposal, hash: string) {
  const { bundler } = await modularReadClient(proposal.wallet);
  const result = await bundler.getUserOperationReceipt({ hash: hash as `0x${string}` });
  return result.receipt.transactionHash;
}

/** Outer transaction success alone is insufficient for an ERC-4337 payment. */
export async function verifyPaymentUserOperation(receipt: TransactionReceipt, proposal: PaymentProposal, knownHash?: string | null) {
  const quoted = proposal.feeQuote?.userOperation;
  if (!quoted || receipt.status !== "success" || receipt.blockNumber <= BigInt(proposal.startBlock)) throw new Error("USER_OPERATION_NOT_VERIFIED");
  const { account, bundler } = await modularReadClient(proposal.wallet);
  const events = receipt.logs.flatMap((log) => {
    if (log.address.toLowerCase() !== account.entryPoint.address.toLowerCase()) return [];
    try {
      const event = decodeEventLog({ abi: entryPoint07Abi, topics: log.topics, data: log.data });
      if (event.eventName !== "UserOperationEvent" || event.args.sender.toLowerCase() !== quoted.sender.toLowerCase() || event.args.nonce !== BigInt(quoted.nonce) || event.args.paymaster.toLowerCase() !== quoted.paymaster.toLowerCase() || (knownHash && event.args.userOpHash.toLowerCase() !== knownHash.toLowerCase())) return [];
      return [event];
    } catch { return []; }
  });
  if (events.length !== 1) throw new Error("USER_OPERATION_EVENT_NOT_VERIFIED");
  const event = events[0];
  const actual = await bundler.getUserOperation({ hash: event.args.userOpHash });
  const op = actual.userOperation as UserOperation<"0.7">;
  if (actual.transactionHash?.toLowerCase() !== receipt.transactionHash.toLowerCase() || actual.entryPoint.toLowerCase() !== account.entryPoint.address.toLowerCase() || op.sender.toLowerCase() !== quoted.sender.toLowerCase() || op.nonce !== BigInt(quoted.nonce) || op.callData.toLowerCase() !== quoted.callData.toLowerCase() || op.factory?.toLowerCase() !== quoted.factory?.toLowerCase() || op.factoryData?.toLowerCase() !== quoted.factoryData?.toLowerCase() || op.paymaster?.toLowerCase() !== quoted.paymaster.toLowerCase() || op.paymasterData?.toLowerCase() !== quoted.paymasterData.toLowerCase()) throw new Error("USER_OPERATION_PAYLOAD_MISMATCH");
  for (const field of ["callGasLimit", "verificationGasLimit", "preVerificationGas", "paymasterVerificationGasLimit", "paymasterPostOpGasLimit", "maxFeePerGas", "maxPriorityFeePerGas"] as const) if (op[field] === undefined || op[field]! > BigInt(quoted[field])) throw new Error("USER_OPERATION_FEE_CEILING_EXCEEDED");
  if (event.args.actualGasCost > BigInt(proposal.gasBudgetWei)) throw new Error("USER_OPERATION_FEE_CEILING_EXCEEDED");
  return { userOperationHash: event.args.userOpHash, success: event.args.success, nonce: quoted.nonce, paymaster: quoted.paymaster };
}
