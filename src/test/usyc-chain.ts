import { vi } from "vitest";
import { ExecutionRevertedError, TransactionReceiptNotFoundError, encodeAbiParameters, encodeEventTopics, getAddress, toFunctionSelector, zeroAddress } from "viem";
import { SELECTOR_DEPOSIT, SELECTOR_REDEEM, SELECTOR_TRANSFER, USYC_AUTHORITY, USYC_TELLER, USYC_USDC, poolAbi, usdcAbi } from "@/lib/usyc/constants";

/** A signed-in wallet (it needs no USYC allowlisting: only the pool does), another wallet, and Hodd's pool. */
export const WALLET = "0x93A7F9a958171303DE74Ab7f6778D25F96316564" as const;
export const OUTSIDER = "0xdef09d06764ee3ca611ce186f47dbd3f546d2e7c" as const;
export const POOL = getAddress("0x4f1e3b1c0a9d8e7f6a5b4c3d2e1f0a9b8c7d6e5f");
const E18 = 10n ** 18n, VIRTUAL = 1_000_000n;
export const POOL_DEPOSIT_SELECTOR = toFunctionSelector("deposit(uint256,address,uint256)");
export const POOL_REDEEM_SELECTOR = toFunctionSelector("redeem(uint256,address,address,uint256)");

/**
 * A scripted Arc Testnet with Hodd's pool on it. Defaults: the pool holds 20 USYC for 20e12 shares, the wallet has
 * 8e12 shares (8 USYC), the live prices (1.1397 latest, 1.1402 next), no fees and the pool's default caps.
 */
export interface FakeChain {
  shares: bigint; poolUsyc: bigint; supply: bigint; usdcBalance: bigint;
  /** Circle's side: the authority paused, and what the pool itself is permitted to call. */
  paused: boolean; canDeposit: boolean; canRedeem: boolean; canTransfer: boolean;
  latestPrice: bigint; mintPrice: bigint;
  depositsPaused: boolean; maxDeposit: bigint; maxRedeem: bigint | null;
  gasPrice: bigint; approveGas: bigint; depositGas: bigint; redeemGas: bigint;
  /** "revert": the node says the call reverts; "rpc": the node refuses the request (e.g. state overrides). */
  depositEstimate: "ok" | "revert" | "rpc"; redeemEstimate: "ok" | "revert" | "rpc";
  rpcDown: boolean;
}
export const chain = (patch: Partial<FakeChain> = {}): FakeChain => ({
  shares: 8_000_000_000_000n, poolUsyc: 20_000_000n, supply: 20_000_000_000_000n, usdcBalance: 10_862_472n,
  paused: false, canDeposit: true, canRedeem: true, canTransfer: true,
  latestPrice: 1_139_744_957_475_496_722n, mintPrice: 1_140_213_033_752_708_080n,
  depositsPaused: false, maxDeposit: 1_000_000_000n, maxRedeem: null,
  gasPrice: 25_000_000_000n, approveGas: 38_705n, depositGas: 331_000n, redeemGas: 211_000n,
  depositEstimate: "ok", redeemEstimate: "ok", rpcDown: false, ...patch,
});

/** The pool's own arithmetic (HoddUSYCVault): shares ↔ USYC with a 1e6 virtual-share offset, rounded down. */
export const usycOf = (state: FakeChain, shares: bigint) => shares * (state.poolUsyc + 1n) / (state.supply + VIRTUAL);
export const redeemValue = (state: FakeChain, shares: bigint) => usycOf(state, shares) * state.latestPrice / E18;
export const depositShares = (state: FakeChain, assets: bigint) => (assets * E18 / state.mintPrice) * (state.supply + VIRTUAL) / (state.poolUsyc + 1n);

export function fakeArcClient(state: FakeChain) {
  const readContract = vi.fn(async (request: { address: string; functionName: string; args?: readonly unknown[] }) => {
    if (state.rpcDown) throw new Error("HTTP request failed: https://rpc.testnet.arc.network 429 secret-detail");
    const { functionName: name, args = [] } = request, at = request.address.toLowerCase();
    if (at === POOL.toLowerCase()) switch (name) {
      case "balanceOf": return state.shares;
      case "depositsPaused": return state.depositsPaused;
      case "maxDeposit": return state.depositsPaused ? 0n : state.maxDeposit;
      case "maxRedeem": return state.maxRedeem ?? state.shares;
      case "usycOf": return usycOf(state, args[0] as bigint);
      case "previewRedeem": return redeemValue(state, args[0] as bigint);
      case "previewDeposit": return depositShares(state, args[0] as bigint);
      default: throw new Error(`unexpected pool read ${name}`);
    }
    if (at === USYC_USDC.toLowerCase() && name === "balanceOf") return state.usdcBalance;
    if (at === USYC_AUTHORITY.toLowerCase()) {
      if (name === "paused") return state.paused;
      if (name === "canCall") {
        if (state.paused) throw new Error("NoAccess()");
        if ((args[0] as string).toLowerCase() !== POOL.toLowerCase()) return false;
        const selector = args[2];
        return selector === SELECTOR_DEPOSIT ? state.canDeposit : selector === SELECTOR_REDEEM ? state.canRedeem : selector === SELECTOR_TRANSFER ? state.canTransfer : false;
      }
    }
    if (at === USYC_TELLER.toLowerCase()) {
      if (name === "previewDepositData") { const assets = args[1] as bigint; return [assets * E18 / state.mintPrice, 0n, state.mintPrice] as const; }
      if (name === "previewRedeemData") { const usyc = args[1] as bigint; return [usyc * state.latestPrice / E18, 0n, state.latestPrice] as const; }
    }
    throw new Error(`unexpected read ${name} at ${request.address}`);
  });
  const estimateGas = vi.fn(async (request: { to: string; data: `0x${string}`; stateOverride?: unknown }) => {
    if (state.rpcDown) throw new Error("HTTP request failed: secret-detail");
    if (request.to === USYC_USDC) return state.approveGas;
    const selector = request.data.slice(0, 10);
    const mode = selector === POOL_DEPOSIT_SELECTOR ? state.depositEstimate : state.redeemEstimate;
    if (mode === "revert") throw new ExecutionRevertedError({ message: "execution reverted" });
    if (mode === "rpc") throw new Error("state overrides are not supported");
    return selector === POOL_DEPOSIT_SELECTOR ? state.depositGas : state.redeemGas;
  });
  const getGasPrice = vi.fn(async () => { if (state.rpcDown) throw new Error("down"); return state.gasPrice; });
  const getTransactionReceipt = vi.fn();
  return { readContract, estimateGas, getGasPrice, getTransactionReceipt };
}

// Receipts shaped like the pool's on an Arc Testnet fork.
const log = (address: string, abi: typeof poolAbi | typeof usdcAbi, eventName: string, args: Record<string, unknown>, data: readonly unknown[], types: readonly { type: string }[]) =>
  ({ address, topics: encodeEventTopics({ abi, eventName, args } as never) as `0x${string}`[], data: encodeAbiParameters(types as never, data as never) });
const u = { type: "uint256" } as const;
export const shareTransfer = (from: string, to: string, amount: bigint, pool: string = POOL) => log(pool, poolAbi, "Transfer", { from, to }, [amount], [u]);
export const usdcTransfer = (from: string, to: string, amount: bigint) => log(USYC_USDC, usdcAbi, "Transfer", { from, to }, [amount], [u]);
export const usdcApproval = (owner: string, spender: string, amount: bigint) => log(USYC_USDC, usdcAbi, "Approval", { owner, spender }, [amount], [u]);
export const subscribed = (user: string, receiver: string, usdcIn: bigint, usycIn: bigint, shares: bigint, pool: string = POOL) => log(pool, poolAbi, "UsycSubscribed", { user, receiver }, [usdcIn, usycIn, shares], [u, u, u]);
export const redeemed = (user: string, shares: bigint, usycOut: bigint, usdcOut: bigint, pool: string = POOL) => log(pool, poolAbi, "UsycRedeemed", { user }, [shares, usycOut, usdcOut], [u, u, u]);
export const receipt = (status: "success" | "reverted", logs: readonly { address: string; topics: readonly `0x${string}`[]; data: `0x${string}` }[]) => ({ status, logs });
export const notFound = () => new TransactionReceiptNotFoundError({ hash: `0x${"a".repeat(64)}` });
export { USYC_AUTHORITY, USYC_TELLER, zeroAddress };
