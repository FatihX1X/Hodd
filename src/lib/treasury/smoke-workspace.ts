import { usdc } from "./fixtures";
import { createLiveStarterWorkspace } from "./starter";
import { treasuryWorkspaceSchema } from "./models";
export type WorkspaceScope = "TREASURY" | "SMOKE_TEST";
/** Separate zero-funded test ledger; never modifies an existing treasury policy. */
export function createSmokeWorkspace() {
  const now = new Date().toISOString();
  const initialWorkspace = createLiveStarterWorkspace(now);
  return treasuryWorkspaceSchema.parse({ ...structuredClone(initialWorkspace), updatedAt: now, totalTreasury: usdc("0"), liquidUsdc: usdc("0"), obligations: [], decisions: [], strategies: initialWorkspace.strategies.map((item) => ({ ...item, balance: usdc("0"), redeemable: usdc("0") })), policy: { ...initialWorkspace.policy, safetyBuffer: usdc("1000000") }, activities: [{ id: crypto.randomUUID(), occurredAt: now, actor: "HUMAN", action: "Isolated smoke-test workspace created", summary: "Test policy reserves 1 USDC and retains the 60% Morpho cap.", reason: "No existing treasury obligations or policy were changed. Connect a separate test wallet; deposit is limited to 1 USDC by the server.", policy: { status: "NOT_EVALUATED", label: "Smoke test", reason: "Fresh wallet balances and normal engine checks are required." }, approval: "NOT_REQUIRED", execution: "LOCAL_ONLY" }] });
}
