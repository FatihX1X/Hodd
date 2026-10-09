"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { walletApiResponseSchema } from "@/lib/arc/schemas";
import { earnPortfolioApiSchema, type EarnExecutionResult, type EarnPortfolioResponse } from "@/lib/earn/models";
import { assessTreasury, previewAllocation } from "@/lib/treasury/engine";
import { initialWorkspace } from "@/lib/treasury/fixtures";
import { LocalTreasuryRepository } from "@/lib/treasury/repository";
import { formatMoney } from "@/lib/treasury/format";
import { walletConnectionSchema, type ActivityEntry, type Obligation, type ObligationInput, type StrategyKind, type TreasuryPolicy, type TreasuryWorkspace, type WalletConnection, type WalletReadState } from "@/lib/treasury/models";
import { clearActiveWalletRuntime } from "@/lib/wallet/runtime";
import { cloudWorkspaceRevision, isRevisionConflict, knownWorkspaceRevision, loadCloudWorkspace, refreshCloudLedger, syncWorkspaceToCloud } from "@/lib/supabase/workspace-sync";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { createSmokeWorkspace, type WorkspaceScope } from "@/lib/treasury/smoke-workspace";
import { mergePaymentLedger } from "@/lib/payments/workspace";
import { applyChange, type AppliedChange, type ChangeKind } from "@/lib/agent/changes";
import { applyEarnPortfolio, applyWalletSnapshot, makeActivity } from "@/lib/treasury/live";

type Assessment = ReturnType<typeof assessTreasury>;
type AllocationPlan = ReturnType<typeof previewAllocation>;
export type EarnReadState = Readonly<{ status: "IDLE" | "LOADING" }> | Readonly<{ status: "READY"; portfolio: EarnPortfolioResponse }> | Readonly<{ status: "ERROR"; message: string; stalePortfolio?: EarnPortfolioResponse }>;
type WorkspaceContextValue = {
  workspaceScope: WorkspaceScope;
  workspace: TreasuryWorkspace;
  operationalWorkspace: TreasuryWorkspace | null;
  assessment: Assessment | null;
  allocationPlan: AllocationPlan | null;
  walletState: WalletReadState;
  earnState: EarnReadState;
  hydrated: boolean;
  storageIssue: string | null;
  connectWallet(connection: WalletConnection): void;
  disconnectWallet(): void;
  refreshWallet(): void;
  refreshEarn(): void;
  syncForEarn(): Promise<void>;
  refreshPaymentLedger(): Promise<void>;
  paymentLedgerRevision: number;
  recordEarnEvent(stage: string, hash?: string): void;
  recordEarnActivity(action: string, summary: string, reason: string, result?: EarnExecutionResult, state?: Pick<ActivityEntry, "approval" | "execution">): void;
  createObligation(input: ObligationInput): void;
  updateObligation(id: string, input: ObligationInput): void;
  updatePolicy(policy: Pick<TreasuryPolicy, "safetyBuffer" | "minimumLiquidityCoverageBps" | "strategyCapsBps">): void;
  updateTargets(targets: Record<StrategyKind, number>): void;
  /** Dry run of a change proposed in Hoddie chat: exactly what approval would write. Throws a readable Error when not allowed. */
  previewHoddieChange(kind: ChangeKind, change: unknown): AppliedChange;
  /** Applies a change the user approved in Hoddie chat, only if the workspace is still the one the change was prepared against. */
  applyHoddieChange(kind: ChangeKind, change: unknown, expectedUpdatedAt: string): AppliedChange;
  resetWorkspace(): void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

// Pure helpers live in src/lib/treasury/live.ts so the server-side Claude connector can reuse them.
export { applyEarnPortfolio, applyWalletSnapshot };

function operationalInput(workspace: TreasuryWorkspace, walletState: WalletReadState, earnState?: EarnReadState): TreasuryWorkspace | null {
  if (workspace.treasuryMode === "LOCAL_DEMO") return workspace;
  if (walletState.status !== "READY" || walletState.snapshot.address !== workspace.walletConnection?.address) return null;
  const withWallet = applyWalletSnapshot(workspace, walletState.snapshot);
  return earnState?.status === "READY" ? applyEarnPortfolio(withWallet, earnState.portfolio) : withWallet;
}

// Per-tab memory: a reload must not silently drop a smoke test back into the
// main treasury, where reconnecting would replace the main wallet.
const SCOPE_KEY = "hodd:workspace-scope";
function restoredScope(): WorkspaceScope {
  try { return typeof window !== "undefined" && window.sessionStorage.getItem(SCOPE_KEY) === "SMOKE_TEST" ? "SMOKE_TEST" : "TREASURY"; } catch { return "TREASURY"; }
}

export function TreasuryWorkspaceProvider({ children }: { children: React.ReactNode }) {
  // Scope is not rendered before hydration (the banner needs a signed-in user).
  const [workspaceScope, setWorkspaceScopeState] = useState<WorkspaceScope>(restoredScope);
  const setWorkspaceScope = (scope: WorkspaceScope) => { try { window.sessionStorage.setItem(SCOPE_KEY, scope); } catch { /* scope still switches for this page */ } setWorkspaceScopeState(scope); };
  const [workspace, setWorkspace] = useState<TreasuryWorkspace>(initialWorkspace);
  const [evaluatedAt, setEvaluatedAt] = useState(initialWorkspace.updatedAt);
  const [walletState, setWalletState] = useState<WalletReadState>({ status: "IDLE" });
  const [earnState, setEarnState] = useState<EarnReadState>({ status: "IDLE" });
  const [refreshSequence, setRefreshSequence] = useState(0);
  const [earnRefreshSequence, setEarnRefreshSequence] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [storageIssue, setStorageIssue] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | undefined>();
  const [cloudIssue, setCloudIssue] = useState<string | null>(null);
  const [cloudReadable, setCloudReadable] = useState(false);
  const [paymentLedgerRevision, setPaymentLedgerRevision] = useState(0);
  const identityGeneration = useRef(0);

  useEffect(() => {
    let active = true;
    let generation = 0;
    let lastOwner: string | undefined;
    let initialized = false;
    const load = async (owner?: string) => {
      if (initialized && lastOwner === owner) return;
      initialized = true; lastOwner = owner;
      const requestGeneration = ++generation;
      identityGeneration.current++;
      clearActiveWalletRuntime();
      setHydrated(false); setWalletState({ status: "IDLE" }); setEarnState({ status: "IDLE" });
      setWorkspace(structuredClone(initialWorkspace)); setStorageIssue(null); setCloudReadable(false);
      setUserId(owner); setCloudIssue(null);
      const repository = new LocalTreasuryRepository(window.localStorage, workspaceScope === "SMOKE_TEST" ? `${owner ?? "guest"}:smoke` : owner);
      const result = repository.load();
      let cloud: TreasuryWorkspace | null = null;
      try { cloud = owner ? await loadCloudWorkspace(owner, workspaceScope) : null; if (active && generation === requestGeneration) setCloudReadable(true); }
      catch { if (active && generation === requestGeneration) setCloudIssue("Cloud workspace unavailable. Changes remain on this device until sync succeeds."); }
      if (!active || generation !== requestGeneration) return;
      const local = result.status === "EMPTY" && workspaceScope === "SMOKE_TEST" ? createSmokeWorkspace() : result.workspace;
      const candidate = cloud && (result.status === "EMPTY" || result.status === "CORRUPT" || Date.parse(cloud.updatedAt) >= Date.parse(result.workspace.updatedAt)) ? cloud : local;
      const selected = cloud ? mergePaymentLedger(candidate, cloud) : candidate;
      if (result.status === "MIGRATED" || cloud) repository.save(selected);
      setWorkspace(selected);
      setStorageIssue(result.status === "CORRUPT" && !cloud ? result.message : null);
      setEvaluatedAt(new Date().toISOString()); setHydrated(true);
    };
    const client = createSupabaseBrowserClient();
    if (!client) { queueMicrotask(() => { void load(); }); return () => { active = false; }; }
    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === "SIGNED_OUT" || !session) clearActiveWalletRuntime();
      // Supabase callbacks must return before another auth request is made.
      window.setTimeout(() => { if (active) void load(session?.user.id); }, 0);
    });
    return () => { active = false; generation++; data.subscription.unsubscribe(); };
  }, [workspaceScope]);

  // Canonical payment reads update the local cache, never re-upload its old facts.
  useEffect(() => {
    if (hydrated && paymentLedgerRevision) new LocalTreasuryRepository(window.localStorage, workspaceScope === "SMOKE_TEST" ? `${userId ?? "guest"}:smoke` : userId).save(workspace);
  }, [hydrated, paymentLedgerRevision, userId, workspace, workspaceScope]);

  // The cloud copy moved on (another tab, or a change approved in Claude): load it
  // instead of overwriting it with this tab's older copy.
  const adoptCloud = useCallback(async (message: string | null) => {
    if (!userId) return;
    const generation = identityGeneration.current;
    const cloud = await refreshCloudLedger(userId, workspaceScope);
    if (generation !== identityGeneration.current) return;
    new LocalTreasuryRepository(window.localStorage, workspaceScope === "SMOKE_TEST" ? `${userId}:smoke` : userId).save(cloud);
    setWorkspace(cloud); setEvaluatedAt(new Date().toISOString()); setCloudIssue(message);
  }, [userId, workspaceScope]);

  const persist = useCallback((next: TreasuryWorkspace) => {
    new LocalTreasuryRepository(window.localStorage, workspaceScope === "SMOKE_TEST" ? `${userId ?? "guest"}:smoke` : userId).save(next);
    if (userId && !cloudReadable) return;
    void syncWorkspaceToCloud(next, userId, workspaceScope).then(() => setCloudIssue(null)).catch((error: unknown) => {
      if (isRevisionConflict(error)) void adoptCloud("This workspace changed elsewhere (for example through Claude). The latest version was loaded; repeat your last change if it is still needed.").catch(() => setCloudIssue("Cloud sync failed. Your changes are saved on this device."));
      else setCloudIssue("Cloud sync failed. Your changes are saved on this device.");
    });
  }, [userId, cloudReadable, workspaceScope, adoptCloud]);

  // Pick up changes made elsewhere (e.g. approved in Claude) when the tab regains focus.
  useEffect(() => {
    if (!hydrated || !userId || !cloudReadable) return;
    let active = true;
    const check = async () => {
      const known = knownWorkspaceRevision(userId, workspaceScope);
      const current = await cloudWorkspaceRevision(userId, workspaceScope).catch(() => null);
      if (active && current !== null && known !== undefined && current > known) await adoptCloud(null).catch(() => undefined);
    };
    const onFocus = () => { void check(); };
    window.addEventListener("focus", onFocus);
    const interval = window.setInterval(onFocus, 30_000);
    return () => { active = false; window.removeEventListener("focus", onFocus); window.clearInterval(interval); };
  }, [hydrated, userId, cloudReadable, workspaceScope, adoptCloud]);

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

  useEffect(() => {
    if (!hydrated) return;
    let active = true; const controller = new AbortController();
    const load = async () => {
      setEarnState((current) => current.status === "READY" ? current : { status: "LOADING" });
      try {
        const query = walletAddress ? `?address=${encodeURIComponent(walletAddress)}` : "";
        const response = await fetch(`/api/earn/portfolio${query}`, { cache: "no-store", signal: controller.signal });
        const parsed = earnPortfolioApiSchema.safeParse(await response.json());
        if (!parsed.success) throw new Error("INVALID_RESPONSE");
        if (!active) return;
        const data = parsed.data;
        if (data.status === "READY") setEarnState({ status: "READY", portfolio: data });
        else setEarnState((current) => ({ status: "ERROR", message: data.message, stalePortfolio: current.status === "READY" ? current.portfolio : current.status === "ERROR" ? current.stalePortfolio : undefined }));
      } catch (error) {
        if (!active || (error instanceof DOMException && error.name === "AbortError")) return;
        setEarnState((current) => ({ status: "ERROR", message: "Arc Earn data is temporarily unavailable.", stalePortfolio: current.status === "READY" ? current.portfolio : current.status === "ERROR" ? current.stalePortfolio : undefined }));
      }
    };
    void load(); const interval = window.setInterval(load, 45_000); const onFocus = () => { void load(); }; window.addEventListener("focus", onFocus);
    return () => { active = false; controller.abort(); window.clearInterval(interval); window.removeEventListener("focus", onFocus); };
  }, [earnRefreshSequence, hydrated, walletAddress]);

  const commit = useCallback((next: TreasuryWorkspace) => {
    if (storageIssue || !hydrated) return;
    try {
      const input = operationalInput(next, walletState, earnState);
      const evaluation = input ? assessTreasury(input, new Date(next.updatedAt)) : null;
      const blocked = evaluation?.violations.some((item) => item.severity === "BLOCKED") ?? false;
      const evaluated: TreasuryWorkspace = { ...next, activities: [{
        id: crypto.randomUUID(), occurredAt: next.updatedAt, actor: "SYSTEM", action: evaluation ? "Treasury Engine evaluated" : "Treasury Engine paused",
        summary: evaluation ? `Deployable capital recalculated to ${formatMoney(evaluation.deployableCapital)}.` : "A fresh Arc Testnet balance is required before financial outputs can be recalculated.",
        reason: evaluation ? "A workspace input changed, so protected capital, coverage and feasibility outputs were recomputed." : "Hodd does not use a demo or stale wallet balance while live treasury mode is active.",
        policy: evaluation ? { status: blocked ? "BLOCKED" : evaluation.violations.length ? "REVIEW" : "PASS", label: "Treasury policy", reason: evaluation.violations.map((item) => item.message).join(" ") || "All configured liquidity rules pass." } : { status: "NOT_EVALUATED", label: "Live balance required", reason: "The engine failed closed until Arc data is available." },
        approval: "NOT_REQUIRED", execution: "LOCAL_ONLY",
      }, ...next.activities] };
      persist(evaluated);
      setWorkspace(evaluated); setEvaluatedAt(evaluated.updatedAt);
    } catch { setStorageIssue("The browser could not persist this workspace. Reset it before making more changes."); }
  }, [earnState, storageIssue, walletState, hydrated, persist]);

  const connectWallet = (candidate: WalletConnection) => {
    const parsed = walletConnectionSchema.safeParse(candidate);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? "Invalid wallet connection");
    const now = new Date().toISOString(); setWalletState({ status: "LOADING" });
    commit({ ...workspace, treasuryMode: "ARC_TESTNET_WALLET", walletConnection: parsed.data, updatedAt: now, activities: [makeActivity("User-controlled wallet connected", `${parsed.data.label} is now the single authoritative Arc Testnet treasury wallet.`, "Hodd stores only public wallet metadata. Signing remains on the selected user-controlled wallet surface.", now), ...workspace.activities] });
  };
  const disconnectWallet = () => { const now = new Date().toISOString(); clearActiveWalletRuntime(); setWalletState({ status: "IDLE" }); setEarnState({ status: "IDLE" }); commit({ ...workspace, treasuryMode: "LOCAL_DEMO", walletConnection: null, updatedAt: now, activities: [makeActivity("Wallet disconnected", "The workspace returned to its local demo treasury balance.", "Disconnecting removes the public connection metadata from Hodd and never alters the user-owned wallet.", now), ...workspace.activities] }); };
  const refreshWallet = () => setRefreshSequence((value) => value + 1);
  const refreshEarn = () => setEarnRefreshSequence((value) => value + 1);
  const recordEarnActivity = (action: string, summary: string, reason: string, result?: EarnExecutionResult, state?: Pick<ActivityEntry, "approval" | "execution">) => {
    const now = new Date().toISOString();
    const activity: ActivityEntry = { id: crypto.randomUUID(), occurredAt: now, actor: "HUMAN", action, summary, reason, policy: { status: result?.status === "PARTIAL" || result?.status === "UNKNOWN" || state?.execution === "UNKNOWN" ? "REVIEW" : "PASS", label: result ? "Onchain receipt" : "Earn local audit", reason: result ? "The record was created from the confirmed App Kit response." : "This record describes local authorization or request state and is not an onchain receipt." }, approval: state?.approval ?? (result ? "APPROVED" : "PENDING"), execution: state?.execution ?? result?.status ?? "NOT_STARTED", transactionHash: result?.txHash, explorerUrl: result?.explorerUrl };
    setWorkspace((current) => {
      const next = { ...current, updatedAt: now, activities: [activity, ...current.activities] };
      try { persist(next); setEvaluatedAt(now); return next; }
      catch { setStorageIssue("The browser could not persist this audit record. Reset the workspace before continuing."); return current; }
    });
  };
  const recordEarnEvent = (stage: string, hash?: string) => {
    const confirmed = stage === "APPROVAL_CONFIRMED" || stage === "EARN_CONFIRMED";
    const transaction = hash && (confirmed || stage === "TRANSACTION_SUBMITTED") ? hash : undefined;
    const now = new Date().toISOString();
    const entry: ActivityEntry = { id: crypto.randomUUID(), occurredAt: now, actor: "SYSTEM", action: `Earn ${stage.toLowerCase().replaceAll("_", " ")}`, summary: hash ? `${stage} · ${hash}` : stage, reason: confirmed ? "The server verified the Arc receipt against the expected call or vault operation." : stage === "USER_OPERATION_SUBMITTED" ? "UserOperation hash only; this is not a transaction receipt." : "Local execution progress, not proof of onchain success.", policy: { status: confirmed ? "PASS" : "NOT_EVALUATED", label: confirmed ? "ONCHAIN RECEIPT" : "LOCAL AUDIT", reason: confirmed ? "Verified receipt" : "Observed execution stage" }, approval: "APPROVED", execution: confirmed ? "COMPLETE" : hash ? "SUBMITTED" : "NOT_STARTED", transactionHash: transaction, explorerUrl: transaction ? `https://testnet.arcscan.app/tx/${transaction}` : undefined };
    setWorkspace((current) => { const next = { ...current, updatedAt: now, activities: [entry, ...current.activities] }; persist(next); return next; });
  };
  const createObligation = (input: ObligationInput) => { const now = new Date().toISOString(); const obligation: Obligation = { ...input, id: crypto.randomUUID(), revision: 1 }; commit({ ...workspace, updatedAt: now, obligations: [...workspace.obligations, obligation], activities: [makeActivity("Obligation created", `${obligation.title} was added as ${obligation.status.toLowerCase()}.`, "The obligation was added to this browser's local treasury workspace.", now), ...workspace.activities] }); };
  const updateObligation = (id: string, input: ObligationInput) => {
    const previous = workspace.obligations.find((item) => item.id === id);
    if (!previous) return;
    if (previous.status === "PAID" || workspace.paymentReservations?.some((item) => item.obligationId === id)) throw new Error("Paid or pending obligations cannot be edited.");
    const now = new Date().toISOString();
    commit({ ...workspace, updatedAt: now, obligations: workspace.obligations.map((item) => item.id === id ? { ...item, ...input, id, revision: (item.revision ?? 1) + 1 } : item), activities: [makeActivity("Obligation updated", `${input.title} was updated.`, "The saved obligation changed and the Treasury Engine recalculated the workspace when verified funds were available.", now), ...workspace.activities] });
  };
  const updatePolicy: WorkspaceContextValue["updatePolicy"] = (policy) => { const now = new Date().toISOString(); commit({ ...workspace, updatedAt: now, policy: { ...workspace.policy, ...policy }, activities: [makeActivity("Treasury policy updated", "Safety buffer, coverage floor or allocation limits changed.", "The local policy was edited and will be evaluated against the authoritative treasury source.", now), ...workspace.activities] }); };
  const updateTargets = (targets: Record<StrategyKind, number>) => { const now = new Date().toISOString(); commit({ ...workspace, updatedAt: now, targetAllocationsBps: targets, activities: [makeActivity("Allocation targets updated", "Investment targets were updated for preview.", "Targets affect deterministic previews only and cannot move funds.", now), ...workspace.activities] }); };
  const resetWorkspace = () => { clearActiveWalletRuntime(); const repository = new LocalTreasuryRepository(window.localStorage, workspaceScope === "SMOKE_TEST" ? `${userId ?? "guest"}:smoke` : userId); const base = repository.reset(); const reset = workspaceScope === "SMOKE_TEST" ? createSmokeWorkspace() : { ...base, updatedAt: new Date().toISOString() }; persist(reset); setWorkspace(reset); setWalletState({ status: "IDLE" }); setEarnState({ status: "IDLE" }); setStorageIssue(null); setEvaluatedAt(reset.updatedAt); setHydrated(true); };

  const operationalWorkspace = useMemo(() => operationalInput(workspace, walletState, earnState), [earnState, workspace, walletState]);
  const assessment = useMemo(() => operationalWorkspace ? assessTreasury(operationalWorkspace, new Date(evaluatedAt)) : null, [operationalWorkspace, evaluatedAt]);
  const allocationPlan = useMemo(() => operationalWorkspace && assessment ? previewAllocation(operationalWorkspace, assessment) : null, [operationalWorkspace, assessment]);
  const syncForEarn = async () => {
    if (!userId || !cloudReadable || storageIssue) throw new Error("Sign in and resolve workspace sync before reviewing an Earn quote.");
    await syncWorkspaceToCloud(workspace, userId, workspaceScope);
  };
  const refreshPaymentLedger = async () => {
    if (!userId || !cloudReadable) throw new Error("Sign in to refresh the canonical payment ledger.");
    const generation = identityGeneration.current;
    const cloud = await refreshCloudLedger(userId, workspaceScope);
    if (generation !== identityGeneration.current) throw new Error("Workspace session changed.");
    setWorkspace((current) => mergePaymentLedger(current, cloud));
    setPaymentLedgerRevision((current) => current + 1);
    setEvaluatedAt(new Date().toISOString()); refreshWallet(); refreshEarn();
  };
  const previewHoddieChange = (kind: ChangeKind, change: unknown) => applyChange(workspace, kind, change, new Date(), undefined, "Hoddie");
  const applyHoddieChange = (kind: ChangeKind, change: unknown, expectedUpdatedAt: string) => {
    if (storageIssue || !hydrated) throw new Error("The workspace is not available for changes right now.");
    if (workspace.updatedAt !== expectedUpdatedAt) throw new Error("The workspace changed after this proposal was prepared. Ask again to get an up-to-date proposal.");
    const applied = applyChange(workspace, kind, change, new Date(), undefined, "Hoddie");
    commit(applied.workspace);
    return applied;
  };
  const value = { workspaceScope, workspace, operationalWorkspace, assessment, allocationPlan, walletState, earnState, hydrated, storageIssue, connectWallet, disconnectWallet, refreshWallet, refreshEarn, syncForEarn, refreshPaymentLedger, paymentLedgerRevision, recordEarnActivity, recordEarnEvent, createObligation, updateObligation, updatePolicy, updateTargets, previewHoddieChange, applyHoddieChange, resetWorkspace };
  return <WorkspaceContext.Provider value={value}>{userId && <div role="note" className="flex flex-wrap items-center justify-between gap-3 border-b border-white/[0.14] bg-[#fff2d4] px-5 py-3 text-xs"><p>{workspaceScope === "SMOKE_TEST" ? "SMOKE-TEST WORKSPACE · separate ledger, 1 USDC initial buffer, max 1 USDC deposit. Connect a different test wallet; your main treasury is unchanged." : "Main treasury workspace · isolated smoke tests do not change its obligations or policy."}</p><button disabled={!hydrated} onClick={() => { clearActiveWalletRuntime(); setWorkspaceScope(workspaceScope === "TREASURY" ? "SMOKE_TEST" : "TREASURY"); }} className="shrink-0 border border-white/20 px-3 py-2">{workspaceScope === "SMOKE_TEST" ? "Return to treasury" : "Open isolated smoke workspace"}</button></div>}{cloudIssue && <div role="status" className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 bg-[#fff2d4] px-5 py-3 text-xs">{cloudIssue}<button onClick={() => window.location.reload()} className="border border-white/[0.14] px-3 py-2">Reload and retry sync</button></div>}{children}</WorkspaceContext.Provider>;
}

export function useTreasuryWorkspace() { const context = useContext(WorkspaceContext); if (!context) throw new Error("useTreasuryWorkspace must be used within TreasuryWorkspaceProvider"); return context; }

export function WorkspaceRecoveryBanner() {
  const { storageIssue, resetWorkspace } = useTreasuryWorkspace();
  if (!storageIssue) return null;
  return <div role="alert" className="border-b border-[#ff9a92]/30 bg-[#d03b3b]/15 px-5 py-3 text-xs text-[#ff9a92] md:px-8 lg:px-10"><div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3"><span>{storageIssue} No saved value was used in calculations.</span><button onClick={resetWorkspace} className="border border-[#ff9a92]/40 px-3 py-2 font-semibold hover:bg-white/30">Reset demo workspace</button></div></div>;
}
