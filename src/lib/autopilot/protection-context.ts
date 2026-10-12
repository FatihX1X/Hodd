import "server-only";
import type { ProtectionContext } from "@/lib/treasury/engine";
import { loadMandate } from "./store";
import { autopilotIsActive } from "./protection";
/** Missing or unavailable mandate data must retain the manual protection default. */
export async function loadProtectionContext(userId: string, scope = "TREASURY"): Promise<ProtectionContext> {
  if (scope !== "TREASURY") return { autopilotActive: false };
  try {
    const stored = await loadMandate(userId);
    return { autopilotActive: autopilotIsActive({ mandate: stored?.mandate, returnRequested: stored?.return_requested }) };
  } catch { return { autopilotActive: false }; }
}
/**
 * The console's view of the protection mode: always 200 and only the mandate row, so it never logs a browser
 * error for signed-out or switched-off users and never triggers balance reads against the public RPC.
 */
export async function autopilotActiveResponse() {
  let active = false;
  try { const { earnServerContext } = await import("@/lib/earn/server-context"); active = (await loadProtectionContext((await earnServerContext()).userId)).autopilotActive; }
  catch { /* Signed out, no wallet workspace or unavailable: the manual default. */ }
  return Response.json({ active }, { headers: { "Cache-Control": "no-store" } });
}
