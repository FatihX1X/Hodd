import type { AppKit } from "@circle-fin/app-kit";
import type { WalletConnection } from "@/lib/treasury/models";

export type EarnAdapter = Parameters<AppKit["earn"]["getPosition"]>[0]["from"]["adapter"];
export type ActiveWalletRuntime = Readonly<{ connection: WalletConnection; adapter: EarnAdapter | null }>;

let activeRuntime: ActiveWalletRuntime | null = null;
export function setActiveWalletRuntime(runtime: ActiveWalletRuntime) { activeRuntime = runtime; }
export function getActiveWalletRuntime() { return activeRuntime; }
export function clearActiveWalletRuntime() { activeRuntime = null; }
