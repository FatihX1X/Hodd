"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { getAddress } from "viem";
import { walletApiResponseSchema, walletAddressInputSchema } from "@/lib/arc/schemas";
import { assessTreasury, previewAllocation } from "@/lib/treasury/engine";
import { initialWorkspace } from "@/lib/treasury/fixtures";
import { LocalTreasuryRepository } from "@/lib/treasury/repository";
import { formatMoney } from "@/lib/treasury/format";
import type { ActivityEntry, Obligation, ObligationInput, StrategyKind, TreasuryPolicy, TreasuryWorkspace, WalletReadState, WalletSnapshot } from "@/lib/treasury/models";

type Assessment = ReturnType<typeof assessTreasury>;
type AllocationPlan = ReturnType<typeof previewAllocation>;
type WorkspaceContextValue = {
  workspace: TreasuryWorkspace;
  operationalWorkspace: TreasuryWorkspace | null;
  assessment: Assessment | null;
  allocationPlan: AllocationPlan | null;
  walletState: WalletReadState;
  hydrated: boolean;
  storageIssue: string | null;
  connectWallet(address: string, label: string): void;
  disconnectWallet(): void;
  refreshWallet(): void;
  createObligation(input: ObligationInput): void;
  updateObligation(id: string, input: ObligationInput): void;
  updatePolicy(policy: Pick<TreasuryPolicy, "safetyBuffer" | "minimumLiquidityCoverageBps" | "strategyCapsBps">): void;
  updateTargets(targets: Record<StrategyKind, number>): void;
  resetWorkspace(): void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function makeActivity(action: string, summary: string, reason: string, occurredAt: string): ActivityEntry {
  return { id: crypto.randomUUID(), occurredAt, actor: "HUMAN", action, summary, reason, policy: { status: "PASS", label: "Local validation", reason: "The change passed schema and deterministic policy input validation." }, approval: "NOT_REQUIRED", execution: "LOCAL_ONLY" };
}

export function applyWalletSnapshot(workspace: TreasuryWorkspace, snapshot: WalletSnapshot): TreasuryWorkspace {
  const strategies = workspace.strategies.map((strategy) => strategy.kind === "LIQUID" ? { ...strategy, balance: snapshot.balance, redeemable: snapshot.balance, integration: "DEMO" as const } : strategy);
  return { ...workspace, totalTreasury: snapshot.balance, liquidUsdc: snapshot.balance, strategies };
}

function operationalInput(workspace: TreasuryWorkspace, walletState: WalletReadState): TreasuryWorkspace | null {
  if (workspace.treasuryMode === "LOCAL_DEMO") return workspace;
  if (walletState.status !== "READY" || walletState.snapshot.address !== workspace.walletConnection?.address) return null;
  return applyWalletSnapshot(workspace, walletState.snapshot);
}

export function TreasuryWorkspaceProvider({ children }: { children: React.ReactNode }) {
  const [workspace, setWorkspace] = useState<TreasuryWorkspace>(initialWorkspace);
  const [evaluatedAt, setEvaluatedAt] = useState(initialWorkspace.updatedAt);
  const [walletState, setWalletState] = useState<WalletReadState>({ status: "IDLE" });
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [storageIssue, setStorageIssue] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const repository = new LocalTreasuryRepository(window.localStorage);
      const result = repository.load();
      if (result.status === "MIGRATED") repository.save(result.workspace);
      setWorkspace(result.workspace);
      setStorageIssue(result.status === "CORRUPT" ? result.message : null);
      setEvaluatedAt(new Date().toISOString()); setHydrated(true);
    });
    return () => { active = false; };
  }, []);

  const walletAddress = workspace.treasuryMode === "ARC_TESTNET_WALLET" ? workspace.walletConnection?.address : undefined;
  useEffect(() => {
    if (!hydrated || !walletAddress) return;
    let active = true;
    let controller: AbortController | null = null;
    const load = async () => {
      controller?.abort(); controller = new AbortController();
      setWalletState((current) => current.status === "READY" ? current : { status: "LOADING" });
      try {
        const response = await fetch(`/api/arc/treasury?address=${encodeURIComponent(walletAddress)}`, { cache: "no-store", signal: controller.signal });
        const parsed = walletApiResponseSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("INVALID_RESPONSE");
        if (!active) return;
        const data = parsed.data;
        if (data.status === "READY") setWalletState({ status: "READY", snapshot: data.snapshot });
        else setWalletState((current) => ({ status: "ERROR", code: data.code, message: data.message, staleSnapshot: current.status === "READY" ? current.snapshot : current.status === "ERROR" ? current.staleSnapshot : undefined }));
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setWalletState((current) => ({ status: "ERROR", code: "RPC_UNAVAILABLE", message: "Arc Testnet is temporarily unavailable. Financial outputs are paused.", staleSnapshot: current.status === "READY" ? current.snapshot : current.status === "ERROR" ? current.staleSnapshot : undefined }));
      }
    };
    void load();
    const interval = window.setInterval(load, 30_000);
    const onFocus = () => { void load(); };
    window.addEventListener("focus", onFocus);
    return () => { active = false; controller?.abort(); window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [hydrated, refreshSequence, walletAddress]);

  const commit = useCallback((next: TreasuryWorkspace) => {
    if (storageIssue) return;
    try {
      const input = operationalInput(next, walletState);
      const evaluation = input ? assessTreasury(input, new Date(next.updatedAt)) : null;
      const blocked = evaluation?.violations.some((item) => item.severity === "BLOCKED") ?? false;
      const evaluated: TreasuryWorkspace = { ...next, activities: [{
        id: crypto.randomUUID(), occurredAt: next.updatedAt, actor: "SYSTEM", action: evaluation ? "Treasury Engine evaluated" : "Treasury Engine paused",
        summary: evaluation ? `Deployable capital recalculated to ${formatMoney(evaluation.deployableCapital)}.` : "A fresh Arc Testnet balance is required before financial outputs can be recalculated.",
        reason: evaluation ? "A workspace input changed, so protected capital, coverage and feasibility outputs were recomputed." : "Hodd does not use a demo or stale wallet balance while live treasury mode is active.",
        policy: evaluation ? { status: blocked ? "BLOCKED" : evaluation.violations.length ? "REVIEW" : "PASS", label: "Treasury policy", reason: evaluation.violations.map((item) => item.message).join(" ") || "All configured liquidity rules pass." } : { status: "NOT_EVALUATED", label: "Live balance required", reason: "The engine failed closed until Arc data is available." },
        approval: "NOT_REQUIRED", execution: "LOCAL_ONLY",
      }, ...next.activities] };
      new LocalTreasuryRepository(window.localStorage).save(evaluated);
      setWorkspace(evaluated); setEvaluatedAt(evaluated.updatedAt);
    } catch { setStorageIssue("The browser could not persist this workspace. Reset it before making more changes."); }
  }, [storageIssue, walletState]);

  const connectWallet = (address: string, label: string) => {
    const parsed = walletAddressInputSchema.safeParse(address);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid wallet address");
    const now = new Date().toISOString(); const normalized = getAddress(parsed.data); setWalletState({ status: "LOADING" });
    commit({ ...workspace, treasuryMode: "ARC_TESTNET_WALLET", walletConnection: { provider: "CIRCLE_AGENT_WALLET", chain: "ARC-TESTNET", chainId: 5_042_002, address: normalized, label: label.trim() || "Treasury wallet", connectedAt: now }, updatedAt: now, activities: [makeActivity("Circle Agent Wallet linked", `${label.trim() || "Treasury wallet"} was linked in read-only mode.`, "Only the public Arc Testnet address is stored. Hodd has no signing or transaction capability.", now), ...workspace.activities] });
  };
  const disconnectWallet = () => { const now = new Date().toISOString(); setWalletState({ status: "IDLE" }); commit({ ...workspace, treasuryMode: "LOCAL_DEMO", walletConnection: null, updatedAt: now, activities: [makeActivity("Circle Agent Wallet disconnected", "The workspace returned to its local demo treasury balance.", "Disconnecting removes only the public address from Hodd and does not alter the Circle wallet.", now), ...workspace.activities] }); };
  const refreshWallet = () => setRefreshSequence((value) => value + 1);
  const createObligation = (input: ObligationInput) => { const now = new Date().toISOString(); const obligation: Obligation = { ...input, id: crypto.randomUUID() }; commit({ ...workspace, updatedAt: now, obligations: [...workspace.obligations, obligation], activities: [makeActivity("Obligation created", `${obligation.title} was added as ${obligation.status.toLowerCase()}.`, "The obligation was added to this browser's local treasury workspace.", now), ...workspace.activities] }); };
  const updateObligation = (id: string, input: ObligationInput) => { if (!workspace.obligations.some((item) => item.id === id)) return; const now = new Date().toISOString(); commit({ ...workspace, updatedAt: now, obligations: workspace.obligations.map((item) => item.id === id ? { ...input, id } : item), activities: [makeActivity("Obligation updated", `${input.title} was updated.`, "The saved obligation changed and the Treasury Engine recalculated the workspace when verified funds were available.", now), ...workspace.activities] }); };
  const updatePolicy: WorkspaceContextValue["updatePolicy"] = (policy) => { const now = new Date().toISOString(); commit({ ...workspace, updatedAt: now, policy: { ...workspace.policy, ...policy }, activities: [makeActivity("Treasury policy updated", "Safety buffer, coverage floor or allocation limits changed.", "The local policy was edited and will be evaluated against the authoritative treasury source.", now), ...workspace.activities] }); };
  const updateTargets = (targets: Record<StrategyKind, number>) => { const now = new Date().toISOString(); commit({ ...workspace, updatedAt: now, targetAllocationsBps: targets, activities: [makeActivity("Allocation targets updated", "Investment targets were updated for preview.", "Targets affect deterministic previews only and cannot move funds.", now), ...workspace.activities] }); };
  const resetWorkspace = () => { const reset = new LocalTreasuryRepository(window.localStorage).reset(); setWorkspace(reset); setWalletState({ status: "IDLE" }); setStorageIssue(null); setEvaluatedAt(new Date().toISOString()); setHydrated(true); };

  const operationalWorkspace = useMemo(() => operationalInput(workspace, walletState), [workspace, walletState]);
  const assessment = useMemo(() => operationalWorkspace ? assessTreasury(operationalWorkspace, new Date(evaluatedAt)) : null, [operationalWorkspace, evaluatedAt]);
  const allocationPlan = useMemo(() => operationalWorkspace && assessment ? previewAllocation(operationalWorkspace, assessment) : null, [operationalWorkspace, assessment]);
  const value = { workspace, operationalWorkspace, assessment, allocationPlan, walletState, hydrated, storageIssue, connectWallet, disconnectWallet, refreshWallet, createObligation, updateObligation, updatePolicy, updateTargets, resetWorkspace };
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useTreasuryWorkspace() { const context = useContext(WorkspaceContext); if (!context) throw new Error("useTreasuryWorkspace must be used within TreasuryWorkspaceProvider"); return context; }

export function WorkspaceRecoveryBanner() {
  const { storageIssue, resetWorkspace } = useTreasuryWorkspace();
  if (!storageIssue) return null;
  return <div role="alert" className="border-b border-[#9a433c]/25 bg-[#f5dedb] px-5 py-3 text-xs text-[#7b332d] md:px-8 lg:px-10"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3"><span>{storageIssue} No saved value was used in calculations.</span><button onClick={resetWorkspace} className="border border-[#7b332d]/30 px-3 py-2 font-semibold hover:bg-white/30">Reset demo workspace</button></div></div>;
}
