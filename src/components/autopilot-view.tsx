"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits, type Hash } from "viem";
import { PageBody, PageHeader, SectionCard, SectionHeading, KpiGrid, Kpi, StatusPill, buttonClass, inputClass } from "./primitives";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { AutopilotProgress, type AutopilotLocalPhase, type AutopilotProgressInput } from "./autopilot-progress";
import type { Mandate, Decision } from "@/lib/autopilot/models";
import { decimalStringToMoney } from "@/lib/earn/money";
import { getActiveWalletRuntime, isSignerFor, type EarnGasCeiling, type WalletCall } from "@/lib/wallet/runtime";
import { WalletPreflightError } from "@/lib/wallet/preflight";

interface Run { id: string; state: string; decision: Decision; failure: string | null; created_at: string }
interface Status {
  executionEnabled: boolean; policyMorphoCapBps: number; mode: string;
  wallet: { address: string; owner_address: string; account_type: string } | null;
  mandate: Mandate | null; spentMinor: string; returnRequested: boolean;
  balances: { cashMinor: string; positionMinor: string; redeemableMinor: string; observedAt: string } | null;
  balanceError: string | null; runs: Run[];
  steps: { id: string; run_id: string; stage: string; state: string; tx_hash: string | null; circle_transaction_id: string | null }[];
}
interface Funding { agentAddress: string; funding: { call: WalletCall; gasBudgetWei: string; gasCeiling: EarnGasCeiling; amountMinor: string } }
class ApiError extends Error {
  constructor(message: string, readonly code: string) { super(message); }
}
const display = (minor: string) => formatUnits(BigInt(minor), 6) + " USDC";
const rounded = (minor: string) => {
  const cents = (BigInt(minor) + 5_000n) / 10_000n;
  return (cents / 100n).toString() + "." + (cents % 100n).toString().padStart(2, "0") + " USDC";
};
const isOpen = (run?: Run | null) => run?.state === "RUNNING" || run?.state === "UNKNOWN";
// Plain words for the run outcomes a user can meet; anything else keeps its code.
const outcomes: Record<string, string> = {
  AGENT_MANDATE_CHANGED: "Stopped because Autopilot was paused or changed. Nothing else was sent.",
  AGENT_PAUSED: "Stopped because Autopilot is switched off. Nothing else was sent.",
  AGENT_RETURN_HAS_RESIDUAL_ASSETS: "Most of your USDC is back. A small amount is still with the agent; press Return everything again.",
  AGENT_RECOVERED_REVIEW_BEFORE_NEXT_RUN: "The earlier transaction is confirmed. You can continue.",
  AGENT_QUOTE_EXPIRED: "The quote expired before signing. Nothing was sent; try again.",
  AGENT_FRESH_POLICY_BLOCKED: "Balances changed and Hodd's limits stopped this step. Nothing else was sent.",
};
const outcome = (failure: string) => outcomes[failure] ?? failure.replaceAll("_", " ");
const errorMessage = (error: unknown) => error instanceof Error ? error.message : "The request is unresolved. Check history before trying again.";
function rejected(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const detail = error as { code?: number; message?: string; cause?: unknown };
  return detail.code === 4001 || /user rejected|user denied/i.test(detail.message ?? "") || (detail.cause !== error && rejected(detail.cause));
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
async function post<T>(action: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch("/api/autopilot/" + action, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  const data = await response.json();
  signal.throwIfAborted();
  if (!response.ok) throw new ApiError(data.message ?? "Autopilot could not complete the request.", data.code ?? "ERROR");
  return data;
}

export function AutopilotView() {
  const { signedIn, workspace } = useTreasuryWorkspace();
  const [status, setStatus] = useState<Status | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState("");
  const [share, setShare] = useState<string | null>(null);
  const [phase, setPhase] = useState<AutopilotLocalPhase | null>(null);
  // A failure before the agent run exists halts the rail at the step it reached (wallet cancel, refusal, revert).
  const [failure, setFailure] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<Run | null>(null);
  const [intent, setIntent] = useState<"invest" | "return" | null>(null);
  const [manualAddress, setManualAddress] = useState("");
  const [countdown, setCountdown] = useState<number | null>(null);
  const [candidate, setCandidate] = useState("");
  const [fundingHash, setFundingHash] = useState<string | null>(null);
  const lifecycle = useRef<AbortController | null>(null);
  const acting = useRef(false);
  const load = useCallback(async (signal: AbortSignal) => {
    const response = await fetch("/api/autopilot/status", { cache: "no-store", signal });
    const data: Status & { message?: string } = await response.json();
    if (!response.ok) throw new Error(data.message ?? "Autopilot status is unavailable.");
    signal.throwIfAborted();
    setStatus(data);
    window.dispatchEvent(new Event("hodd:autopilot-status"));
    return data;
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    acting.current = false;
    queueMicrotask(() => {
      if (controller.signal.aborted) return;
      setStatus(null); setActiveRun(null); setIntent(null); setPhase(null); setFailure(null); setMessage(""); setBusy(false);
      setManualAddress(""); setCountdown(null); setShare(null);
      if (signedIn) void load(controller.signal).catch(error => {
        if (!controller.signal.aborted) setMessage(errorMessage(error));
      });
    });
    return () => controller.abort();
  }, [signedIn, workspace.walletConnection?.address, workspace.walletConnection?.connectedAt, load]);

  const run = activeRun ?? status?.runs.find(isOpen);
  const open = isOpen(run);
  const runId = run?.id;
  // Advance only this open run; never replay a transaction or start another run here.
  useEffect(() => {
    if (!open || !runId || !signedIn) return;
    const controller = new AbortController();
    const poll = async () => {
      while (!controller.signal.aborted) {
        await wait(3_000, controller.signal);
        try {
          const result = await post<{ run: Run | null }>("status", {}, controller.signal);
          const fresh = await load(controller.signal);
          const current = fresh.runs.find(item => item.id === runId) ?? result.run;
          if (current) setActiveRun(current);
          if (current && !isOpen(current)) { setPhase(null); return; }
        } catch (error) {
          if (controller.signal.aborted) return;
          setMessage(errorMessage(error));
        }
      }
    };
    void poll().catch(() => { /* cancellation stops the timer */ });
    return () => controller.abort();
  }, [open, runId, signedIn, load]);

  /** `flow`: Invest or Return. Their failures stop the progress rail where they happened instead of raising an alert. */
  async function act(action: (signal: AbortSignal) => Promise<void>, flow?: "invest" | "return") {
    const signal = lifecycle.current?.signal;
    if (!signal || signal.aborted || acting.current) return;
    acting.current = true; setBusy(true); setMessage(""); setFailure(null);
    if (flow) setIntent(flow);
    try { await action(signal); }
    catch (error) {
      if (!signal.aborted) {
        if (flow) setFailure(errorMessage(error)); else { setMessage(errorMessage(error)); setPhase(null); }
        setCountdown(null);
        if (error instanceof ApiError && error.code === "AGENT_RUN_OPEN") await load(signal).catch(() => {});
      }
    } finally {
      if (!signal.aborted) { acting.current = false; setBusy(false); }
    }
  }

  async function startRun(action: "run" | "return-all", signal: AbortSignal) {
    setIntent(action === "run" ? "invest" : "return");
    const deadline = Date.now() + 6 * 60_000;
    for (;;) {
      signal.throwIfAborted();
      try {
        const result = await post<{ run: Run | null }>(action, action === "return-all" ? { phase: "now" } : {}, signal);
        setCountdown(null); setActiveRun(result.run); setPhase(null);
        await load(signal);
        return;
      } catch (error) {
        if (!(error instanceof ApiError) || error.code !== "AGENT_RATE_LIMIT" || Date.now() >= deadline) throw error;
        setPhase("cooldown");
        const retryAt = Math.min(Date.now() + 30_000, deadline);
        while (Date.now() < retryAt) {
          setCountdown(Math.ceil((retryAt - Date.now()) / 1_000));
          await wait(Math.min(1_000, retryAt - Date.now()), signal);
        }
      }
    }
  }

  async function invest(signal: AbortSignal) {
    if (!status) return;
    let amountMinor: string;
    try { amountMinor = decimalStringToMoney(amount).minorUnits; }
    catch { throw new Error("Enter a USDC amount with up to 6 decimal places."); }
    if (BigInt(amountMinor) <= 0n) throw new Error("Enter an amount greater than zero.");
    const maxMorphoBps = Math.round(Number(share ?? status.policyMorphoCapBps / 100) * 100);
    if (!Number.isFinite(maxMorphoBps) || maxMorphoBps < 0 || maxMorphoBps > status.policyMorphoCapBps) throw new Error("Choose a Morpho share within your policy limit.");
    setActiveRun(null); setManualAddress(""); setFundingHash(null); setPhase("preparing");
    const before = await load(signal);
    // Balances exist only once a mandate does; a wallet without one starts from zero.
    if (before.balanceError) throw new Error(before.balanceError);
    const baseline = BigInt(before.balances?.cashMinor ?? "0");
    const result = await post<Funding>("invest", { amountMinor, maxMorphoBps }, signal);
    signal.throwIfAborted();
    const signer = getActiveWalletRuntime();
    if (!isSignerFor(signer, workspace.walletConnection) || !signer.sendCalls) {
      setMessage("Reconnect your wallet to sign the funding transfer");
      setManualAddress(result.agentAddress); setPhase("funding");
      // PIN wallets can fund manually. Observe the requested cash increase before investing.
      for (;;) {
        await wait(3_000, signal);
        const fresh = await load(signal);
        if (fresh.wallet?.address.toLowerCase() === result.agentAddress.toLowerCase() && fresh.balances && BigInt(fresh.balances.cashMinor) >= baseline + BigInt(result.funding.amountMinor)) break;
      }
    } else {
      setPhase("wallet");
      let hash: Hash;
      // The server already checked the balance and estimated gas: the wallet signs inside that ceiling with no browser RPC.
      try { hash = await signer.sendCalls([result.funding.call], result.funding.gasBudgetWei, undefined, undefined, result.funding.gasCeiling); }
      catch (error) {
        if (rejected(error)) throw new Error("Cancelled in your wallet. Nothing was sent.");
        if (error instanceof WalletPreflightError) throw new Error(error.code === "WALLET_SESSION_CHANGED" ? "Your wallet switched account or network. Choose your Hodd account on Arc Testnet and press Invest again. Nothing was sent." : "Your wallet could not prepare the transfer. Nothing was sent; press Invest again.");
        throw error;
      }
      signal.throwIfAborted(); setFundingHash(hash); setPhase("funding");
      await arrived(hash, signal);
    }
    setManualAddress(""); setMessage(""); setPhase("starting");
    await startRun("run", signal);
  }

  /** Waits until Hodd's server sees the owner's transfer land with the agent (no browser RPC). */
  async function arrived(txHash: string, signal: AbortSignal) {
    const deadline = Date.now() + 3 * 60_000;
    for (;;) {
      const check = await post<{ status: "PENDING" | "ARRIVED" | "REVERTED" | "UNRELATED" }>("funding", { txHash }, signal).catch(error => { if (signal.aborted) throw error; return { status: "PENDING" as const }; });
      if (check.status === "ARRIVED") return;
      if (check.status === "REVERTED") throw new Error("The funding transfer reverted on Arc Testnet. The agent did not start investing.");
      if (check.status === "UNRELATED") throw new Error("That transaction did not send USDC to your agent. The agent did not start investing.");
      if (Date.now() >= deadline) throw new Error("Your transfer has not arrived yet. Check it on ArcScan; nothing else was sent and the agent did not start.");
      await wait(2_000, signal);
    }
  }

  const disabled = busy || open || !!status?.runs.some(isOpen) || !signedIn || !status?.executionEnabled;
  const total = status?.balances ? (BigInt(status.balances.cashMinor) + BigInt(status.balances.positionMinor)).toString() : null;
  const unknownStep = status?.steps.find(step => step.state === "UNKNOWN" || step.state === "SUBMITTING");
  const runSteps = status?.steps.filter(step => step.run_id === run?.id) ?? [];
  const returning = run?.decision.kind === "RETURN_ALL" || intent === "return";
  const destination = status?.wallet?.owner_address;
  const result = run?.state === "COMPLETED" ? returning ? "Done. " + rounded(run.decision.transferMinor) + " sent to your wallet." : status?.balances ? "Done. " + rounded(status.balances.positionMinor) + " in Morpho, " + rounded(status.balances.cashMinor) + " ready as cash." : "Done." : run?.state === "NO_ACTION" ? returning ? "Nothing to return." : run.decision.explanation : run?.state === "FAILED" || run?.state === "PARTIAL" ? (run.failure ? outcome(run.failure) : run.decision.explanation) : null;

  // Status lists steps newest first; the rail reads them oldest first.
  const progress: AutopilotProgressInput = { flow: intent ?? (returning ? "return" : "invest"), local: phase, run: run ? { ...run, state: run.state as NonNullable<AutopilotProgressInput["run"]>["state"] } : null, steps: [...runSteps].reverse(), error: failure, countdown, result, fundingHash };
  return <>
    <PageHeader eyebrow="Agent treasury · Arc Testnet" title="Autopilot" description="Invest with your agent or return its USDC to your verified wallet in one click." />
    <PageBody>
      <div className="mb-6 flex flex-wrap items-center gap-3 border border-white/15 p-4">
        <StatusPill label={status?.executionEnabled ? "Testnet execution enabled" : "Autopilot disabled"} tone={status?.executionEnabled ? "info" : "warning"} />
        <p className="text-sm text-white/60">{!signedIn ? "Sign in and connect a verified wallet to use Autopilot." : !status?.executionEnabled ? "The operator must enable and verify Autopilot before funds can move." : "You sign the funding transfer. Your agent handles the rest within Hodd's limits."}</p>
      </div>
      {message && <p role="alert" className="mb-6 border border-[#fab219]/40 p-4 text-sm text-[#ffd27f]">{message}</p>}
      {status?.balanceError && <p className="mb-5 text-sm text-[#ffd27f]">{status.balanceError}</p>}
      <KpiGrid columns={3} label="Agent balances"><Kpi label="Agent cash" value={status?.balances ? display(status.balances.cashMinor) : "Unavailable"} /><Kpi label="In Morpho" value={status?.balances ? display(status.balances.positionMinor) : "Unavailable"} /><Kpi label="Total with agent" value={total === null ? "Unavailable" : display(total)} /></KpiGrid>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <SectionCard><SectionHeading index="01" title="Invest" /><form className="space-y-4 p-5" onSubmit={event => { event.preventDefault(); if (!disabled) void act(invest, "invest"); }}>
          <label className="block text-xs text-white/60">Amount (USDC)<input className={inputClass} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="10" required disabled={busy || open} /></label>
          <button className={buttonClass.primary} disabled={disabled}>{amount.trim() ? "Invest " + amount.trim() + " USDC" : "Invest"}</button>
          <p className="text-sm text-white/60">Your wallet sends the USDC to your agent; the agent puts up to {(status?.policyMorphoCapBps ?? 0) / 100}% into Morpho within Hodd&apos;s limits and keeps the rest ready as cash.</p>
        </form></SectionCard>
        <SectionCard><SectionHeading index="02" title="Return to my wallet" /><div className="space-y-4 p-5 text-sm">
          <p>{total === null ? "Balance unavailable" : display(total)} with your agent. A tiny network-fee remainder stays behind.</p>
          <p className="text-white/60">Destination: {destination ? <span title={destination} className="font-mono">{destination.slice(0, 6)}…{destination.slice(-4)}</span> : "Connect your verified wallet"}</p>
          <button className={buttonClass.primary} disabled={disabled || total === null || BigInt(total) === 0n || !destination} onClick={() => void act(async signal => { setActiveRun(null); setPhase("preparing"); await startRun("return-all", signal); }, "return")}>Return everything</button>
        </div></SectionCard>
      </div>
      {(phase || failure || open || result) && <SectionCard className="mt-6"><SectionHeading index="03" title="Progress" />
        <AutopilotProgress input={progress} />
        {manualAddress && <div className="space-y-3 px-5 pb-5 text-sm"><p>Send {amount} USDC on Arc Testnet to your agent. Investing starts automatically after the funds arrive.</p><label className="block text-xs text-white/60">Agent funding address<input className={inputClass + " font-mono"} readOnly value={manualAddress} onFocus={event => event.target.select()} /></label><button className={buttonClass.ghost} onClick={() => void navigator.clipboard.writeText(manualAddress).catch(() => setMessage("Select the agent address to copy it."))}>Copy agent address</button></div>}
      </SectionCard>}
      <details className="mt-6 border border-white/15"><summary className="cursor-pointer p-5 text-sm">Settings</summary><div className="space-y-4 p-5 text-sm">
        <label className="block text-xs text-white/60">Morpho share (%)<input className={inputClass} type="number" min="0" max={(status?.policyMorphoCapBps ?? 0) / 100} step="0.01" value={share ?? (status ? String(status.policyMorphoCapBps / 100) : "")} onChange={event => setShare(event.target.value)} disabled={busy || open} /></label>
        <button className={buttonClass.ghost} disabled={disabled || !status?.mandate} onClick={() => void act(async signal => { await post("pause", {}, signal); await load(signal); setMessage("Paused. Already submitted transactions can still settle."); })}>Pause autopilot</button>
        {status?.wallet && <><p className="break-all font-mono">{status.wallet.address}</p><a className="text-[#9ec5f4] underline" href={"https://testnet.arcscan.app/address/" + status.wallet.address} target="_blank" rel="noreferrer">View agent on ArcScan</a></>}
      </div></details>
      <details className="mt-6 border border-white/15"><summary className="cursor-pointer p-5 text-sm">History</summary>
        <div className="divide-y divide-white/10">{status?.runs.length?status.runs.map(run=><article className="space-y-3 p-5" key={run.id}><div className="flex flex-wrap justify-between gap-3"><StatusPill label={run.state} tone={run.state==="UNKNOWN"?"warning":run.state==="COMPLETED"?"success":"neutral"}/><span className="text-xs text-white/50">{new Date(run.created_at).toLocaleString()}</span></div><p className="text-sm">{run.decision.explanation}</p><p className="text-xs text-white/60">Deposit {display(run.decision.depositMinor)} · withdraw {display(run.decision.withdrawMinor)} · return {display(run.decision.transferMinor)}</p>{run.failure&&<p className="text-xs text-[#ffd27f]">{outcome(run.failure)}</p>}{status.steps.filter(step=>step.run_id===run.id).map(step=><p className="break-all text-xs text-white/60" key={step.id}>{step.stage} · {step.state}{step.tx_hash&&<> · <a className="text-[#9ec5f4] underline" href={"https://testnet.arcscan.app/tx/"+step.tx_hash} target="_blank" rel="noreferrer">ArcScan receipt</a></>}{step.circle_transaction_id&&<> · Circle {step.circle_transaction_id}</>}</p>)}</article>):<p className="p-5 text-sm text-white/60">No runs yet. Invest to start your agent.</p>}</div>
      </details>
            {unknownStep && <SectionCard className="mt-6"><SectionHeading index="05" title="Recover an uncertain submission" description="Paste the hash for the displayed step. Exact sender, calldata and receipt must match; no funds are resent."/><form className="space-y-3 p-5" onSubmit={e=>{e.preventDefault();void act(async signal => { await post("recover", {stepId:unknownStep.id,txHash:candidate}, signal); await load(signal); });}}><p className="break-all text-xs text-white/60">Step {unknownStep.id}</p><label className="text-xs">Transaction hash<input className={inputClass} value={candidate} onChange={e=>setCandidate(e.target.value)} pattern="0x[0-9a-fA-F]{64}" required/></label><button className={buttonClass.ghost} disabled={busy || !signedIn || !status?.executionEnabled}>Verify transaction</button></form></SectionCard>}
    </PageBody>
  </>;
}
