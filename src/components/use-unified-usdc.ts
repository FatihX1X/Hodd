"use client";

import { useCallback, useEffect, useState } from "react";
import { z } from "zod";
import { unifiedUsdcViewSchema, type UnifiedUsdcView } from "@/lib/gateway/models";

const responseSchema = z.union([z.object({ status: z.literal("READY"), view: unifiedUsdcViewSchema }), z.object({ status: z.literal("ERROR"), message: z.string() })]);
export type UnifiedUsdcState = Readonly<{ status: "IDLE" | "LOADING" }> | Readonly<{ status: "READY"; view: UnifiedUsdcView }> | Readonly<{ status: "ERROR"; message: string; stale?: UnifiedUsdcView }>;

/** Public cross-chain USDC read for one address. Never feeds the Treasury Engine. */
export function useUnifiedUsdc(address: string | null | undefined) {
  const [state, setState] = useState<UnifiedUsdcState>({ status: "IDLE" });
  const load = useCallback(async (signal?: AbortSignal) => {
    if (!address) { setState({ status: "IDLE" }); return null; }
    setState((current) => current.status === "READY" ? current : { status: "LOADING" });
    try {
      const response = await fetch(`/api/gateway/balances?address=${encodeURIComponent(address)}`, { cache: "no-store", signal });
      const body = responseSchema.parse(await response.json());
      if (body.status === "ERROR") { setState((current) => ({ status: "ERROR", message: body.message, stale: current.status === "READY" ? current.view : undefined })); return null; }
      if (body.view.address.toLowerCase() !== address.toLowerCase()) return null;
      setState({ status: "READY", view: body.view }); return body.view;
    } catch (cause) {
      if (signal?.aborted) return null;
      setState((current) => ({ status: "ERROR", message: cause instanceof Error && cause.name !== "ZodError" ? "Cross-chain balances are unavailable right now." : "Cross-chain balances could not be verified.", stale: current.status === "READY" ? current.view : undefined }));
      return null;
    }
  }, [address]);
  useEffect(() => { const controller = new AbortController(); queueMicrotask(() => void load(controller.signal)); return () => controller.abort(); }, [load]);
  return { state, reload: () => load() };
}
