import { sampleWorkspace } from "./fixtures";
import type { Obligation, TreasuryWorkspace } from "./models";
import { createLiveStarterWorkspace } from "./starter";

export function canDeleteObligation(workspace: TreasuryWorkspace, obligation: Obligation) {
  return obligation.status !== "PAID" && !obligation.paymentReference && !workspace.paymentReservations?.some((reservation) => reservation.obligationId === obligation.id);
}

/** The confirmation and cleanup use the same list; user-authored records are preserved. */
export function sampleDataRemoval(workspace: TreasuryWorkspace) {
  const obligations = workspace.obligations.filter((item) => sampleWorkspace.obligations.some((sample) => sample.id === item.id) && canDeleteObligation(workspace, item));
  const activities = workspace.activities.filter((item) => sampleWorkspace.activities.some((sample) => sample.id === item.id));
  const decisions = workspace.decisions.filter((item) => sampleWorkspace.decisions.some((sample) => sample.id === item.id));
  const resetTargets = Object.entries(sampleWorkspace.targetAllocationsBps).every(([kind, value]) => workspace.targetAllocationsBps[kind as keyof typeof workspace.targetAllocationsBps] === value);
  const resetBuffer = Object.entries(sampleWorkspace.policy.safetyBuffer).every(([key, value]) => workspace.policy.safetyBuffer[key as keyof typeof workspace.policy.safetyBuffer] === value);
  return { obligations, activities, decisions, resetTargets, resetBuffer };
}

export function hasSampleData(workspace: TreasuryWorkspace): boolean {
  const removal = sampleDataRemoval(workspace);
  return Boolean(removal.obligations.length || removal.activities.length || removal.decisions.length || removal.resetTargets || removal.resetBuffer);
}

export function removeSampleData(workspace: TreasuryWorkspace, now: Date | string): TreasuryWorkspace {
  const removal = sampleDataRemoval(workspace);
  const starter = createLiveStarterWorkspace(now);
  return {
    ...workspace, updatedAt: starter.updatedAt,
    obligations: workspace.obligations.filter((item) => !removal.obligations.some((sample) => sample.id === item.id)),
    activities: workspace.activities.filter((item) => !removal.activities.some((sample) => sample.id === item.id)),
    decisions: workspace.decisions.filter((item) => !removal.decisions.some((sample) => sample.id === item.id)),
    targetAllocationsBps: removal.resetTargets ? starter.targetAllocationsBps : { ...workspace.targetAllocationsBps },
    policy: { ...workspace.policy, safetyBuffer: removal.resetBuffer ? starter.policy.safetyBuffer : { ...workspace.policy.safetyBuffer } },
  };
}
