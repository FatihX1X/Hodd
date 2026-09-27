"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { assessTreasury, previewAllocation } from "@/lib/treasury/engine";
import { initialWorkspace } from "@/lib/treasury/fixtures";
import { LocalTreasuryRepository } from "@/lib/treasury/repository";
import { formatMoney } from "@/lib/treasury/format";
import type { ActivityEntry, Obligation, ObligationInput, StrategyKind, TreasuryPolicy, TreasuryWorkspace } from "@/lib/treasury/models";

type WorkspaceContextValue = {
  workspace: TreasuryWorkspace;
  assessment: ReturnType<typeof assessTreasury>;
  allocationPlan: ReturnType<typeof previewAllocation>;
  hydrated: boolean;
  storageIssue: string | null;
  createObligation(input: ObligationInput): void;
  updateObligation(id: string, input: ObligationInput): void;
  updatePolicy(policy: Pick<TreasuryPolicy, "safetyBuffer" | "minimumLiquidityCoverageBps" | "strategyCapsBps">): void;
  updateTargets(targets: Record<StrategyKind, number>): void;
  resetWorkspace(): void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function makeActivity(action: string, summary: string, reason: string, occurredAt: string): ActivityEntry {
  return {
    id: crypto.randomUUID(), occurredAt, actor: "HUMAN", action, summary, reason,
    policy: { status: "PASS", label: "Local validation", reason: "The change passed schema and deterministic policy input validation." },
    approval: "NOT_REQUIRED", execution: "LOCAL_ONLY",
  };
}

export function TreasuryWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<TreasuryWorkspace>(initialWorkspace);
  const [evaluatedAt, setEvaluatedAt] = useState(initialWorkspace.updatedAt);
  const [hydrated, setHydrated] = useState(false);
  const [storageIssue, setStorageIssue] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const result = new LocalTreasuryRepository(window.localStorage).load();
      setWorkspace(result.workspace);
      setStorageIssue(result.status === "CORRUPT" ? result.message : null);
      setEvaluatedAt(new Date().toISOString());
      setHydrated(true);
    });
    return () => { active = false; };
  }, []);

  const commit = (next: TreasuryWorkspace) => {
    if (storageIssue) return;
    try {
      const evaluation = assessTreasury(next, new Date(next.updatedAt));
      const blocked = evaluation.violations.some((item) => item.severity === "BLOCKED");
      const evaluated: TreasuryWorkspace = {
        ...next,
        activities: [{
          id: crypto.randomUUID(), occurredAt: next.updatedAt, actor: "SYSTEM", action: "Treasury Engine evaluated",
          summary: `Deployable capital recalculated to ${formatMoney(evaluation.deployableCapital)}.`,
          reason: "A local workspace input changed, so all protected capital, coverage and feasibility outputs were recomputed.",
          policy: { status: blocked ? "BLOCKED" : evaluation.violations.length ? "REVIEW" : "PASS", label: "Treasury policy", reason: evaluation.violations.map((item) => item.message).join(" ") || "All configured liquidity rules pass." },
          approval: "NOT_REQUIRED", execution: "LOCAL_ONLY",
        }, ...next.activities],
      };
      new LocalTreasuryRepository(window.localStorage).save(evaluated);
      setWorkspace(evaluated);
      setEvaluatedAt(evaluated.updatedAt);
    } catch {
      setStorageIssue("The browser could not persist this workspace. Reset it before making more changes.");
    }
  };

  const createObligation = (input: ObligationInput) => {
    const now = new Date().toISOString();
    const obligation: Obligation = { ...input, id: crypto.randomUUID() };
    commit({ ...workspace, updatedAt: now, obligations: [...workspace.obligations, obligation], activities: [makeActivity("Obligation created", `${obligation.title} was added as ${obligation.status.toLowerCase()}.`, "The obligation was added to this browser's local treasury workspace.", now), ...workspace.activities] });
  };

  const updateObligation = (id: string, input: ObligationInput) => {
    const existing = workspace.obligations.find((item) => item.id === id);
    if (!existing) return;
    const now = new Date().toISOString();
    commit({ ...workspace, updatedAt: now, obligations: workspace.obligations.map((item) => item.id === id ? { ...input, id } : item), activities: [makeActivity("Obligation updated", `${input.title} was updated.`, "The saved obligation changed and the Treasury Engine recalculated the workspace.", now), ...workspace.activities] });
  };

  const updatePolicy: WorkspaceContextValue["updatePolicy"] = (policy) => {
    const now = new Date().toISOString();
    commit({ ...workspace, updatedAt: now, policy: { ...workspace.policy, ...policy }, activities: [makeActivity("Treasury policy updated", "Safety buffer, coverage floor or allocation limits changed.", "The local policy was edited by the user and all engine outputs were recalculated.", now), ...workspace.activities] });
  };

  const updateTargets = (targets: Record<StrategyKind, number>) => {
    const now = new Date().toISOString();
    commit({ ...workspace, updatedAt: now, targetAllocationsBps: targets, activities: [makeActivity("Allocation targets updated", "Investment targets were updated for preview.", "Targets affect deterministic previews only and cannot move funds.", now), ...workspace.activities] });
  };

  const resetWorkspace = () => {
    const reset = new LocalTreasuryRepository(window.localStorage).reset();
    setWorkspace(reset); setStorageIssue(null); setEvaluatedAt(new Date().toISOString()); setHydrated(true);
  };

  const assessment = useMemo(() => assessTreasury(workspace, new Date(evaluatedAt)), [workspace, evaluatedAt]);
  const allocationPlan = useMemo(() => previewAllocation(workspace, assessment), [workspace, assessment]);
  const value = { workspace, assessment, allocationPlan, hydrated, storageIssue, createObligation, updateObligation, updatePolicy, updateTargets, resetWorkspace };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useTreasuryWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error("useTreasuryWorkspace must be used within TreasuryWorkspaceProvider");
  return context;
}

export function WorkspaceRecoveryBanner() {
  const { storageIssue, resetWorkspace } = useTreasuryWorkspace();
  if (!storageIssue) return null;
  return <div role="alert" className="border-b border-[#9a433c]/25 bg-[#f5dedb] px-5 py-3 text-xs text-[#7b332d] md:px-8 lg:px-10"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3"><span>{storageIssue} No saved value was used in calculations.</span><button onClick={resetWorkspace} className="border border-[#7b332d]/30 px-3 py-2 font-semibold hover:bg-white/30">Reset demo workspace</button></div></div>;
}
