import { vi } from "vitest";
import { ExecutionRevertedError, TransactionReceiptNotFoundError, encodeAbiParameters, encodeEventTopics, zeroAddress } from "viem";
import { SELECTOR_DEPOSIT, SELECTOR_REDEEM, SELECTOR_TRANSFER, USYC_AUTHORITY, USYC_TELLER, USYC_TOKEN, USYC_USDC, tellerAbi, usdcAbi, usycTokenAbi } from "@/lib/usyc/constants";

/** The allowlisted wallet the live checks use (holds USYC on Arc Testnet) and one that is not allowlisted. */
export const WALLET = "0x93A7F9a958171303DE74Ab7f6778D25F96316564" as const;
export const OUTSIDER = "0xdef09d06764ee3ca611ce186f47dbd3f546d2e7c" as const;
export const TREASURY = "0xe287AC3C71F2EFfCc77D02d628EAbe9F6eE8515a" as const;
const E18 = 10n ** 18n;

/** A scripted Arc Testnet. Defaults mirror the live testnet: price 1.1397, subscribe price 1.1402 (next price), no fees, 1,000,000 USDC limits. */
export interface FakeChain {
  usycBalance: bigint; usdcBalance: bigint; paused: boolean;
  canDeposit: boolean; canRedeem: boolean; canTransfer: boolean;
  latestPrice: bigint; mintPrice: bigint; depositFee: bigint; redeemFee: bigint;
  subscribeLeft: bigint; redeemLeft: bigint; maxRedeem: bigint | null;
  gasPrice: bigint; approveGas: bigint; depositGas: bigint; redeemGas: bigint;
  /** "revert": the node says the call reverts; "rpc": the node refuses the request (e.g. state overrides). */
  depositEstimate: "ok" | "revert" | "rpc"; redeemEstimate: "ok" | "revert" | "rpc";
  rpcDown: boolean;
}
export const chain = (patch: Partial<FakeChain> = {}): FakeChain => ({
  usycBalance: 8_000_290n, usdcBalance: 10_862_472n, paused: false, canDeposit: true, canRedeem: true, canTransfer: true,
  latestPrice: 1_139_744_957_475_496_722n, mintPrice: 1_140_213_033_752_708_080n, depositFee: 0n, redeemFee: 0n,
  subscribeLeft: 999_990_000_000n, redeemLeft: 999_999_122_397n, maxRedeem: null,
  gasPrice: 25_000_000_000n, approveGas: 38_705n, depositGas: 215_262n, redeemGas: 190_330n,
  depositEstimate: "ok", redeemEstimate: "ok", rpcDown: false, ...patch,
});

export function fakeArcClient(state: FakeChain) {
  const value = (balance: bigint, price: bigint) => balance * price / E18;
  const readContract = vi.fn(async (request: { address: string; functionName: string; args?: readonly unknown[] }) => {
    if (state.rpcDown) throw new Error("HTTP request failed: https://rpc.testnet.arc.network 429 secret-detail");
    const { functionName: name, args = [] } = request;
    switch (name) {
      case "balanceOf": return request.address === USYC_TOKEN ? state.usycBalance : state.usdcBalance;
      case "paused": return state.paused;
      case "todayTimestamp": return 1_791_763_200n;
      case "previewDepositData": { const assets = args[1] as bigint; return [(assets - state.depositFee) * E18 / state.mintPrice, state.depositFee, state.mintPrice] as const; }
      case "previewRedeemData": { const shares = args[1] as bigint; return [value(shares, state.latestPrice) - state.redeemFee, state.redeemFee, state.latestPrice] as const; }
      case "convertToAssets": return value(args[0] as bigint, state.latestPrice);
      case "subscriptionFeeRate": return 40_000_000_000_000_000n;
      case "redemptionFeeRate": return 30_000_000_000_000_000n;
      case "subscriptionLimitRemaining": return state.subscribeLeft;
      case "redemptionLimitRemaining": return state.redeemLeft;
      case "maxRedeem": return state.maxRedeem ?? state.usycBalance;
      case "canCall": {
        if (state.paused) throw new Error("NoAccess()");
        const selector = args[2];
        return selector === SELECTOR_DEPOSIT ? state.canDeposit : selector === SELECTOR_REDEEM ? state.canRedeem : selector === SELECTOR_TRANSFER ? state.canTransfer : false;
      }
      default: throw new Error(`unexpected read ${name}`);
    }
  });
  const estimateGas = vi.fn(async (request: { to: string; data: `0x${string}`; stateOverride?: unknown }) => {
    if (state.rpcDown) throw new Error("HTTP request failed: secret-detail");
    if (request.to === USYC_USDC) return state.approveGas;
    const selector = request.data.slice(0, 10);
    const mode = selector === SELECTOR_DEPOSIT ? state.depositEstimate : state.redeemEstimate;
    if (mode === "revert") throw new ExecutionRevertedError({ message: "execution reverted" });
    if (mode === "rpc") throw new Error("state overrides are not supported");
    return selector === SELECTOR_DEPOSIT ? state.depositGas : state.redeemGas;
  });
  const getGasPrice = vi.fn(async () => { if (state.rpcDown) throw new Error("down"); return state.gasPrice; });
  const getTransactionReceipt = vi.fn();
  return { readContract, estimateGas, getGasPrice, getTransactionReceipt };
}

// Receipts shaped like the real ones on Arc Testnet (see tx 0x6d5c173e… subscribe and 0x26350ca8… redeem).
const log = (address: string, abi: typeof tellerAbi | typeof usdcAbi | typeof usycTokenAbi, eventName: string, args: Record<string, unknown>, data: readonly unknown[], types: readonly { type: string }[]) =>
  ({ address, topics: encodeEventTopics({ abi, eventName, args } as never), data: encodeAbiParameters(types as never, data as never) });
const u = { type: "uint256" } as const;
export const usycTransfer = (from: string, to: string, amount: bigint) => log(USYC_TOKEN, usycTokenAbi, "Transfer", { from, to }, [amount], [u]);
export const usdcTransfer = (from: string, to: string, amount: bigint) => log(USYC_USDC, usdcAbi, "Transfer", { from, to }, [amount], [u]);
export const usdcApproval = (owner: string, spender: string, amount: bigint) => log(USYC_USDC, usdcAbi, "Approval", { owner, spender }, [amount], [u]);
export const subscribed = (from: string, receiver: string, assets: bigint, shares: bigint, price = 1_140_213_033_752_708_080n, fee = 0n) => log(USYC_TELLER, tellerAbi, "Subscribe", { from, receiver }, [assets, shares, price, fee], [u, u, u, u]);
export const redeemed = (from: string, receiver: string, assets: bigint, shares: bigint, price = 1_139_744_957_475_496_722n, fee = 0n) => log(USYC_TELLER, tellerAbi, "Redeem", { from, receiver }, [assets, shares, price, fee], [u, u, u, u]);
export const receipt = (status: "success" | "reverted", logs: readonly { address: string; topics: readonly `0x${string}`[]; data: `0x${string}` }[]) => ({ status, logs });
export const notFound = () => new TransactionReceiptNotFoundError({ hash: `0x${"a".repeat(64)}` });
export { USYC_AUTHORITY, zeroAddress };
