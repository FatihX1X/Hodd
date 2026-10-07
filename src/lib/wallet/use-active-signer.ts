"use client";

import { useSyncExternalStore } from "react";
import type { WalletConnection } from "@/lib/treasury/models";
import { isSignerFor, peekActiveWalletRuntime, subscribeActiveWalletRuntime } from "./runtime";

/** True only while an in-memory signer matches the persisted wallet connection. */
export function useHasActiveSigner(connection: WalletConnection | null | undefined) {
  const runtime = useSyncExternalStore(subscribeActiveWalletRuntime, peekActiveWalletRuntime, () => null);
  return isSignerFor(runtime, connection);
}
