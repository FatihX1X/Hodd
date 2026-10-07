import type { AppKit } from "@circle-fin/app-kit";
import type { WalletConnection } from "@/lib/treasury/models";
import type { WalletFeeQuote } from "./fee-quote";

export type EarnAdapter = Parameters<AppKit["earn"]["getPosition"]>[0]["from"]["adapter"];
export type WalletCall = Readonly<{ to: `0x${string}`; data?: `0x${string}`; value?: string }>;
export type EarnGasCeiling = Readonly<{ gasLimit: string; gasPriceWei: string }>;
export type ActiveWalletRuntime = Readonly<{ connection: WalletConnection; adapter: EarnAdapter | null; expiresAt?: number; sendCalls?: (calls: readonly WalletCall[], gasBudgetWei: string, onUserOperation?: (hash: string) => void | Promise<void>, feeQuote?: WalletFeeQuote, earnGasCeiling?: EarnGasCeiling) => Promise<`0x${string}`>; approveChallenge?: (id: string) => Promise<void> }>;

let activeRuntime: ActiveWalletRuntime | null = null;
export function setActiveWalletRuntime(runtime: ActiveWalletRuntime) { activeRuntime = runtime; }
export function getActiveWalletRuntime() { if (activeRuntime?.expiresAt && activeRuntime.expiresAt <= Date.now()) clearActiveWalletRuntime(); return activeRuntime; }
export function clearActiveWalletRuntime() { activeRuntime = null; }
