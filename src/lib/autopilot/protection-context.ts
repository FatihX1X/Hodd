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
