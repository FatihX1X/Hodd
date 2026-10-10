import type { AppKit } from "@circle-fin/app-kit";
import type { WalletConnection } from "@/lib/treasury/models";
import type { WalletFeeQuote } from "./fee-quote";

export type EarnAdapter = Parameters<AppKit["earn"]["getPosition"]>[0]["from"]["adapter"];
export type WalletCall = Readonly<{ to: `0x${string}`; data?: `0x${string}`; value?: string }>;
export type EarnGasCeiling = Readonly<{ gasLimit: string; gasPriceWei: string }>;
/** Circle Gateway signing request: the EIP-712 JSON plus the exact intent and, for own-wallet moves, its sealed handle. */
export type GatewaySignRequest = Readonly<{ typedData: Record<string, unknown>; intent: unknown; handle?: string }>;
export type ActiveWalletRuntime = Readonly<{ connection: WalletConnection; adapter: EarnAdapter | null; expiresAt?: number; sendCalls?: (calls: readonly WalletCall[], gasBudgetWei: string, onUserOperation?: (hash: string) => void | Promise<void>, feeQuote?: WalletFeeQuote, earnGasCeiling?: EarnGasCeiling) => Promise<`0x${string}`>; approveChallenge?: (id: string) => Promise<void>; signMessage?: (message: string) => Promise<`0x${string}`>;
  /** Free EIP-712 signature for a Gateway burn intent (EOA wallets only). */
  signGatewayIntent?: (request: GatewaySignRequest) => Promise<`0x${string}`>;
  /** Sends transactions in order on another Gateway chain (each mined before the next), then returns the wallet to Arc. */
  sendOnChain?: (chain: Readonly<{ chainId: number; label: string; rpc: string; nativeSymbol: string; explorerTx: string }>, calls: readonly WalletCall[], onSent?: (hash: `0x${string}`, index: number) => void) => Promise<`0x${string}`[]> }>;

let activeRuntime: ActiveWalletRuntime | null = null;
let expiryTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const notify = () => { for (const listener of listeners) listener(); };
export function setActiveWalletRuntime(runtime: ActiveWalletRuntime) {
  clearTimeout(expiryTimer); activeRuntime = runtime;
  // Expiry must be visible to the UI, not only discovered at signing time.
  if (runtime.expiresAt) expiryTimer = setTimeout(clearActiveWalletRuntime, Math.max(0, runtime.expiresAt - Date.now()));
  notify();
}
export function getActiveWalletRuntime() { if (activeRuntime?.expiresAt && activeRuntime.expiresAt <= Date.now()) clearActiveWalletRuntime(); return activeRuntime; }
export function clearActiveWalletRuntime() { clearTimeout(expiryTimer); if (!activeRuntime) return; activeRuntime = null; notify(); }
export function subscribeActiveWalletRuntime(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
/** Side-effect-free snapshot for useSyncExternalStore; the expiry timer clears stale signers. */
export function peekActiveWalletRuntime() { return activeRuntime; }
/** A signer in memory that can sign for this exact persisted wallet connection. */
export function isSignerFor(runtime: ActiveWalletRuntime | null, connection: Pick<WalletConnection, "address" | "connectedAt"> | null | undefined): runtime is ActiveWalletRuntime {
  return Boolean(runtime && connection && runtime.connection.connectedAt === connection.connectedAt && runtime.connection.address.toLowerCase() === connection.address.toLowerCase() && (runtime.sendCalls || runtime.approveChallenge));
}
