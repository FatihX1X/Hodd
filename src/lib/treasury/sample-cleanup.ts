import { usdc } from "./fixtures";
import { makeActivity } from "./live";
import type { Obligation, TreasuryWorkspace } from "./models";
import { createLiveStarterWorkspace } from "./starter";

const legacyObligationIds = ["obl-payroll-oct", "obl-aws-oct", "obl-invoice-104"];
const legacyActivityIds = ["act-1", "act-2"];
const legacyDecisionIds = ["decision-1"];
const legacyTargets = { LIQUID: 2000, MORPHO: 5000, USYC: 2000, BTC_RESERVE: 1000 };
const legacyBuffer = usdc("1000000000");

export function canDeleteObligation(workspace: TreasuryWorkspace, obligation: Obligation) {
  return obligation.status !== "PAID" && !obligation.paymentReference && !workspace.paymentReservations?.some((reservation) => reservation.obligationId === obligation.id);
}

/** Legacy identifiers are used only for migration; user-authored records are preserved. */
export function sampleDataRemoval(workspace: TreasuryWorkspace) {
  const obligations = workspace.obligations.filter((item) => legacyObligationIds.includes(item.id) && canDeleteObligation(workspace, item));
  const activities = workspace.activities.filter((item) => legacyActivityIds.includes(item.id));
  const decisions = workspace.decisions.filter((item) => legacyDecisionIds.includes(item.id));
  // Cleanup runs automatically, so settings are reset only in a workspace that still
  // carries a legacy starter record; a user who chose a 1,000 USDC buffer keeps it.
  const seeded = obligations.length > 0 || activities.length > 0 || decisions.length > 0;
  const resetTargets = seeded && Object.entries(legacyTargets).every(([kind, value]) => workspace.targetAllocationsBps[kind as keyof typeof workspace.targetAllocationsBps] === value);
  const resetBuffer = seeded && Object.entries(legacyBuffer).every(([key, value]) => workspace.policy.safetyBuffer[key as keyof typeof workspace.policy.safetyBuffer] === value);
  return { obligations, activities, decisions, resetTargets, resetBuffer };
}

export function hasSampleData(workspace: TreasuryWorkspace): boolean {
  const removal = sampleDataRemoval(workspace);
  return Boolean(removal.obligations.length || removal.activities.length || removal.decisions.length || removal.resetTargets || removal.resetBuffer);
}

export function removeSampleData(workspace: TreasuryWorkspace, now: Date | string): TreasuryWorkspace {
  if (!hasSampleData(workspace)) return workspace;
  const removal = sampleDataRemoval(workspace);
  const starter = createLiveStarterWorkspace(now);
  return {
    ...workspace, updatedAt: starter.updatedAt,
    obligations: workspace.obligations.filter((item) => !removal.obligations.some((sample) => sample.id === item.id)),
    activities: [{ ...makeActivity("Sample records removed", "Legacy starter records and unchanged starter settings were removed.", "User records and bills with payment history or reservations were preserved.", starter.updatedAt), actor: "SYSTEM" }, ...workspace.activities.filter((item) => !removal.activities.some((sample) => sample.id === item.id))],
    decisions: workspace.decisions.filter((item) => !removal.decisions.some((sample) => sample.id === item.id)),
    targetAllocationsBps: removal.resetTargets ? starter.targetAllocationsBps : { ...workspace.targetAllocationsBps },
    policy: { ...workspace.policy, safetyBuffer: removal.resetBuffer ? starter.policy.safetyBuffer : { ...workspace.policy.safetyBuffer } },
  };
}
