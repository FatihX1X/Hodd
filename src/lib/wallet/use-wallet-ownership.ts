"use client";

import { useCallback, useEffect, useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { WalletConnection } from "@/lib/treasury/models";
import { ownershipMessage } from "./ownership";
import { getActiveWalletRuntime, isSignerFor } from "./runtime";

export type OwnershipStatus = "NOT_REQUIRED" | "CHECKING" | "VERIFIED" | "MISSING";

/**
 * Live testnet execution requires a one-time, free signature proving the
 * signed-in user controls the connected wallet. Circle PIN wallets are proven
 * by Circle itself; the dev test signer never runs on the live host.
 */
export function useWalletOwnership(connection: WalletConnection | null, live: boolean) {
  const required = Boolean(live && connection && connection.provider !== "CIRCLE_USER_CONTROLLED" && connection.provider !== "TEST_SIGNER");
  const [status, setStatus] = useState<OwnershipStatus>(required ? "CHECKING" : "NOT_REQUIRED");
  const address = connection?.address.toLowerCase();

  const refresh = useCallback(async () => {
    if (!required || !address) { setStatus("NOT_REQUIRED"); return; }
    const client = createSupabaseBrowserClient();
    if (!client) { setStatus("MISSING"); return; }
    const { data } = await client.from("wallet_ownership_proofs").select("wallet_address").eq("wallet_address", address).maybeSingle();
    setStatus(data ? "VERIFIED" : "MISSING");
  }, [required, address]);

  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);

  const verify = useCallback(async () => {
    const runtime = getActiveWalletRuntime();
    if (!connection || !isSignerFor(runtime, connection) || !runtime.signMessage) throw new Error("Reconnect this wallet first, then verify it.");
    const client = createSupabaseBrowserClient();
    const { data } = client ? await client.auth.getUser() : { data: { user: null } };
    if (!data.user) throw new Error("Sign in before verifying a wallet.");
    const issuedAt = new Date().toISOString();
    const signature = await runtime.signMessage(ownershipMessage(data.user.id, connection.address, issuedAt));
    const response = await fetch("/api/wallet/ownership", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address: connection.address, issuedAt, signature, provider: connection.provider }) });
    const body = await response.json().catch(() => null) as { status?: string; message?: string } | null;
    if (body?.status !== "VERIFIED") throw new Error(body?.message ?? "Wallet ownership could not be verified.");
    setStatus("VERIFIED");
  }, [connection]);

  return { status, verify, refresh };
}
