"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatUnits, type Hash } from "viem";
import { ArrowDownToLine, ArrowRight, Bot, CircleSlash, Sparkles, Copy, Droplets, ExternalLink, History, LifeBuoy, Pause, Settings2, ShieldPlus, TrendingUp, Undo2, Wallet, type LucideIcon } from "lucide-react";
import { PageBody, PageHeader, SectionCard, SectionHeading, StatusPill, buttonClass, inputClass } from "./primitives";
import { Ring, moneyColor } from "./visuals";
import { Tip } from "./tip";
import { useTreasuryWorkspace } from "./treasury-workspace-provider";
import { AutopilotProgress, type AutopilotLocalPhase, type AutopilotProgressInput } from "./autopilot-progress";
import type { Mandate, Decision } from "@/lib/autopilot/models";
import { triggerLabels, type RunTrigger } from "@/lib/autopilot/triggers";
import { decimalStringToMoney } from "@/lib/earn/money";
import { getActiveWalletRuntime, isSignerFor, type EarnGasCeiling, type WalletCall } from "@/lib/wallet/runtime";
import { WalletPreflightError } from "@/lib/wallet/preflight";

interface Run { id: string; state: string; decision: Decision; failure: string | null; created_at: string; snapshot?: { trigger?: RunTrigger } }
interface Status {
  executionEnabled: boolean; policyMorphoCapBps: number; mode: string;
  advisor?: { available: boolean; model: string | null };
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

const usdc = (minor: string) => Number(formatUnits(BigInt(minor), 6));
const words = (value: string) => { const text = value.toLowerCase().replaceAll("_", " "); return text.charAt(0).toUpperCase() + text.slice(1); };
const clamp01 = (value: number) => Number.isFinite(value) ? Math.max(0, Math.min(value, 1)) : 0;
const percent = (ratio: number) => Math.round(clamp01(ratio) * 100) + "%";

/** One icon and colour per kind of decision, shared by the history timeline. */
const decisionKinds: Record<Decision["kind"], { label: string; Icon: LucideIcon; color: string }> = {
  INVEST: { label: "Invested in Morpho", Icon: TrendingUp, color: moneyColor.MORPHO },
  LIQUIDITY_TOP_UP: { label: "Topped up cash", Icon: Droplets, color: moneyColor.LIQUID },
  RESERVE_REFILL: { label: "Refilled the reserve", Icon: ShieldPlus, color: moneyColor.protected },
  RETURN_ALL: { label: "Returned everything", Icon: Undo2, color: moneyColor.safe },
  NO_ACTION: { label: "No action needed", Icon: CircleSlash, color: "#8d8b84" },
  DE_RISK: { label: "Moved Morpho back to cash", Icon: ArrowDownToLine, color: moneyColor.LIQUID },
};
const advisorStates: Record<NonNullable<Decision["advisor"]>["status"], { label: string; tone: "info" | "success" | "warning" | "neutral" }> = {
  APPLIED: { label: "Advisor adjusted", tone: "info" },
  FOLLOWED: { label: "Advisor agreed", tone: "success" },
  REJECTED: { label: "Advice outside limits", tone: "warning" },
  UNAVAILABLE: { label: "Advisor unavailable", tone: "neutral" },
};

/** The advisor's reasoning beside the engine's: what it decided, why, and what the engine had proposed. */
function AdvisorNote({ decision }: { decision: Decision }) {
  const advisor = decision.advisor;
  if (!advisor) return null;
  const state = advisorStates[advisor.status], engine = decisionKinds[advisor.engine.kind] ?? decisionKinds.NO_ACTION;
  return <div className="mt-2 border-l-2 border-[#7fa6ff]/50 bg-[#7fa6ff]/[0.06] px-3 py-2 text-[12px] leading-5">
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1"><span className="inline-flex items-center gap-1.5 text-[#9ec5f4]"><Sparkles aria-hidden="true" className="size-3.5" />{state.label}</span>{advisor.model && <span className="mono text-[11px] text-white/45">{advisor.model}</span>}</p>
    <p className="mt-1 text-white/75">{advisor.rationale}</p>
    {advisor.status === "APPLIED" && <p className="mt-1 text-white/50">Engine proposed: {engine.label.toLowerCase()}{BigInt(advisor.engine.depositMinor) > 0n ? ` ${display(advisor.engine.depositMinor)}` : ""}. {advisor.engine.explanation}</p>}
  </div>;
}
const runTone = (state: string) => state === "UNKNOWN" ? "warning" : state === "COMPLETED" ? "success" : state === "FAILED" ? "danger" : state === "PARTIAL" ? "warning" : "neutral";

/** What the agent holds, as one band: cash on the left, Morpho on the right. */
function HoldingsBar({ balances }: { balances: Status["balances"] }) {
  if (!balances) return <p className="mono mt-2 text-2xl font-medium tracking-[-0.03em] text-white/55">Unavailable</p>;
  const cash = usdc(balances.cashMinor), position = usdc(balances.positionMinor), total = cash + position;
  const sum = (BigInt(balances.cashMinor) + BigInt(balances.positionMinor)).toString();
  const parts = [{ key: "cash", label: "Cash", minor: balances.cashMinor, color: moneyColor.LIQUID }, { key: "morpho", label: "In Morpho", minor: balances.positionMinor, color: moneyColor.MORPHO }];
  return <>
    <p className="mono mt-2 text-3xl font-medium tabular-nums tracking-[-0.03em]">{display(sum)}</p>
    <div role="img" aria-label={`Your agent holds ${display(balances.cashMinor)} as cash and ${display(balances.positionMinor)} in Morpho`} className="mt-4 flex h-3 overflow-hidden bg-white/[0.08]">
      {total > 0 && <><div style={{ width: (cash / total) * 100 + "%", background: moneyColor.LIQUID }} /><div className="flex-1" style={{ background: moneyColor.MORPHO }} /></>}
    </div>
    <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-[13px]">{parts.map(part => <li key={part.key} className="inline-flex items-center gap-2 text-white/70"><span aria-hidden="true" className="size-2.5" style={{ background: part.color }} />{part.label}<span className="mono tabular-nums text-white/90">{display(part.minor)}</span></li>)}</ul>
  </>;
}

/** Spent against the mandate's budget. Without a mandate the ring stays empty. */
function BudgetCard({ mandate, spentMinor }: { mandate: Mandate | null; spentMinor: string }) {
  const budget = mandate ? usdc(mandate.budgetMinor) : 0, spent = usdc(spentMinor);
  const ratio = mandate && budget > 0 ? spent / budget : null;
  const color = ratio !== null && ratio >= 1 ? moneyColor.danger : ratio !== null && ratio > 0.85 ? moneyColor.protected : moneyColor.deployable;
  return <div className="flex items-center justify-between gap-4 bg-[#101319] p-5">
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[12px] text-white/55">Budget used<Tip label="About the budget">The most this agent may use in total. Each run also stays within the per-run limit, and the reserve stays untouched.</Tip></p>
      {mandate ? <>
        <p className="mono mt-2 text-xl font-medium tabular-nums tracking-[-0.03em]">{display(spentMinor)}</p>
        <p className="mono mt-1 text-[12px] tabular-nums text-white/55">of {display(mandate.budgetMinor)}</p>
        <ul className="mt-3 space-y-1 text-[12px] text-white/55">
          <li>Reserve <span className="mono tabular-nums text-white/80">{display(mandate.reserveMinor)}</span></li>
          <li>Per run <span className="mono tabular-nums text-white/80">{display(mandate.maxPerRunMinor)}</span></li>
          {mandate.paused && <li className="pt-1"><StatusPill label="Paused" tone="warning" /></li>}
        </ul>
      </> : <p className="mt-2 text-[13px] text-white/55">No budget set yet</p>}
    </div>
    <Ring ratio={ratio} label="Mandate budget used" color={color} size={84}><span className="mono text-sm tabular-nums">{ratio === null ? "-" : percent(ratio)}</span></Ring>
  </div>;
}

/** The ceiling for Morpho as a ring; the number beside it is the one Invest sends. */
function MorphoShareCard({ value, onChange, capBps, disabled }: { value: string; onChange: (next: string) => void; capBps: number; disabled: boolean }) {
  const ratio = value.trim() === "" ? null : Number(value) / 100;
  return <div className="flex items-center justify-between gap-4 bg-[#101319] p-5">
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-[12px] text-white/55">Most in Morpho<Tip align="end" label="About the Morpho share">The share of the agent&apos;s USDC that may be put into Morpho when you invest. Your policy allows up to {capBps / 100}%; the rest stays ready as cash.</Tip></p>
      <label className="mt-2 block text-[12px] text-white/60">Morpho share (%)<input className={inputClass + " mono !mt-1 max-w-32 tabular-nums"} type="number" min="0" max={capBps / 100} step="0.01" value={value} onChange={event => onChange(event.target.value)} disabled={disabled} /></label>
      <p className="mt-2 text-[12px] text-white/50">Policy limit <span className="mono tabular-nums text-white/75">{capBps / 100}%</span></p>
    </div>
    <Ring ratio={ratio} label="Morpho share" color={moneyColor.MORPHO} size={84}><span className="mono text-sm tabular-nums">{ratio === null ? "-" : percent(ratio)}</span></Ring>
  </div>;
}

/** Runs as a timeline: an icon per kind of decision, the money that moved, and the steps behind it on demand. */
function RunTimeline({ runs, steps }: { runs: Run[]; steps: Status["steps"] }) {
  return <ol className="p-5 pt-2">{runs.map((item, index) => {
    const kind = decisionKinds[item.decision.kind] ?? decisionKinds.NO_ACTION, Icon = kind.Icon;
    const moved = [["Deposit", item.decision.depositMinor], ["Withdraw", item.decision.withdrawMinor], ["Return", item.decision.transferMinor]].filter(([, minor]) => BigInt(minor) > 0n);
    const own = steps.filter(step => step.run_id === item.id);
    return <li key={item.id} className="relative flex gap-4 pb-6 last:pb-0">
      {index < runs.length - 1 && <span aria-hidden="true" className="absolute bottom-0 left-4 top-9 w-px bg-white/10" />}
      <span aria-hidden="true" className="relative grid size-8 shrink-0 place-items-center rounded-full border bg-[#101319]" style={{ borderColor: kind.color, color: kind.color }}><Icon className="size-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1"><p className="text-sm font-medium">{kind.label}</p><StatusPill label={item.state} tone={runTone(item.state)} /></div>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[11px] text-white/45"><span className="mono">{new Date(item.created_at).toLocaleString()}</span>{item.snapshot?.trigger && <span>{triggerLabels[item.snapshot.trigger] ?? item.snapshot.trigger}</span>}</p>
        <p className="mt-2 text-[13px] leading-5 text-white/65">{item.decision.explanation}</p>
        <AdvisorNote decision={item.decision} />
        {moved.length > 0 && <ul className="mt-2 flex flex-wrap gap-2">{moved.map(([label, minor]) => <li key={label} className="border border-white/15 px-2 py-1 text-[12px] text-white/60">{label} <span className="mono tabular-nums text-white/90">{display(minor)}</span></li>)}</ul>}
        {item.failure && <p className="mt-2 text-[12px] text-[#ffd27f]">{outcome(item.failure)}</p>}
        {own.length > 0 && <details className="mt-2"><summary className="inline-flex min-h-11 cursor-pointer items-center text-[12px] text-white/55 hover:text-white">Steps ({own.length})</summary>
          <ul className="space-y-2 pb-2">{own.map(step => <li key={step.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]"><span className="text-white/80">{words(step.stage)}</span><StatusPill label={step.state} tone={step.state === "VERIFIED" ? "success" : step.state === "FAILED" ? "danger" : step.state === "UNKNOWN" ? "warning" : "neutral"} />{step.tx_hash && <a className="inline-flex min-h-8 items-center gap-1 text-[#9ec5f4] underline underline-offset-4" href={"https://testnet.arcscan.app/tx/" + step.tx_hash} target="_blank" rel="noreferrer">ArcScan receipt<ExternalLink aria-hidden="true" className="size-3" /></a>}{step.circle_transaction_id && <span className="mono break-all text-white/50">Circle {step.circle_transaction_id}</span>}</li>)}</ul>
        </details>}
      </div>
    </li>;
  })}</ol>;
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
    <PageHeader eyebrow="Agent treasury" title="Autopilot" description="Invest with your agent, or bring its USDC back to your wallet." />
    <PageBody>
      <div className="mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 border border-white/15 px-4 py-3">
        <StatusPill label={status?.executionEnabled ? "Testnet execution enabled" : "Autopilot disabled"} tone={status?.executionEnabled ? "info" : "warning"} />
        {!signedIn ? <p className="text-sm text-white/60">Sign in and connect a verified wallet to use Autopilot.</p> : !status?.executionEnabled ? <p className="text-sm text-white/60">The operator must enable and verify Autopilot before funds can move.</p> : <Tip label="How Autopilot works">You sign the funding transfer. Your agent handles the rest within Hodd&apos;s limits.</Tip>}
      </div>
      {message && <p role="alert" className="mb-6 border border-[#fab219]/40 p-4 text-sm text-[#ffd27f]">{message}</p>}
      {status?.balanceError && <p className="mb-5 text-sm text-[#ffd27f]">{status.balanceError}</p>}
      <section aria-label="Agent overview" className="grid gap-px border border-white/[0.14] bg-white/[0.14] lg:grid-cols-[1.3fr_1fr_1fr]">
        <div className="bg-[#101319] p-5"><p className="flex items-center gap-1.5 text-[12px] text-white/55"><Bot aria-hidden="true" className="size-3.5" />Total with agent</p><HoldingsBar balances={status?.balances ?? null} /></div>
        <BudgetCard mandate={status?.mandate ?? null} spentMinor={status?.spentMinor ?? "0"} />
        <MorphoShareCard value={share ?? (status ? String(status.policyMorphoCapBps / 100) : "")} onChange={setShare} capBps={status?.policyMorphoCapBps ?? 0} disabled={busy || open} />
      </section>
      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <SectionCard><SectionHeading icon={<TrendingUp aria-hidden="true" className="size-4" />} title="Invest" /><form className="space-y-4 p-5" onSubmit={event => { event.preventDefault(); if (!disabled) void act(invest, "invest"); }}>
          <label className="block text-xs text-white/60">Amount (USDC)<input className={inputClass + " mono tabular-nums"} inputMode="decimal" value={amount} onChange={event => setAmount(event.target.value)} placeholder="10" required disabled={busy || open} /></label>
          <div className="flex flex-wrap items-center gap-2">
            <button className={buttonClass.primary} disabled={disabled}>{amount.trim() ? "Invest " + amount.trim() + " USDC" : "Invest"}</button>
            <Tip label="How investing works">Your wallet sends the USDC to your agent; the agent puts up to {(status?.policyMorphoCapBps ?? 0) / 100}% into Morpho within Hodd&apos;s limits and keeps the rest ready as cash.</Tip>
          </div>
        </form></SectionCard>
        <SectionCard><SectionHeading icon={<Undo2 aria-hidden="true" className="size-4" />} title="Return to my wallet" /><div className="space-y-4 p-5 text-sm">
          <div>
            <p className="flex items-center gap-1 text-[12px] text-white/55">With your agent<Tip align="end" label="About returning">A tiny network-fee remainder stays behind.</Tip></p>
            <p className="mono mt-1 text-2xl font-medium tabular-nums tracking-[-0.03em]">{total === null ? "Balance unavailable" : display(total)}</p>
          </div>
          <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-white/60"><Bot aria-hidden="true" className="size-4 shrink-0" /><ArrowRight aria-hidden="true" className="size-3.5 shrink-0 text-white/40" /><Wallet aria-hidden="true" className="size-4 shrink-0" /><span className="sr-only">Destination:</span>{destination ? <span title={destination} className="mono text-[13px] text-white/80">{destination.slice(0, 6)}…{destination.slice(-4)}</span> : <span>Connect your verified wallet</span>}</p>
          <button className={buttonClass.primary} disabled={disabled || total === null || BigInt(total) === 0n || !destination} onClick={() => void act(async signal => { setActiveRun(null); setPhase("preparing"); await startRun("return-all", signal); }, "return")}>Return everything</button>
        </div></SectionCard>
      </div>
      {(phase || failure || open || result) && <SectionCard className="mt-6"><SectionHeading title="Progress" />
        <AutopilotProgress input={progress} />
        {manualAddress && <div className="space-y-3 px-5 pb-5 text-sm"><p>Send {amount} USDC on Arc Testnet to your agent. Investing starts automatically after the funds arrive.</p><label className="block text-xs text-white/60">Agent funding address<input className={inputClass + " font-mono"} readOnly value={manualAddress} onFocus={event => event.target.select()} /></label><button className={buttonClass.ghost} onClick={() => void navigator.clipboard.writeText(manualAddress).catch(() => setMessage("Select the agent address to copy it."))}><Copy aria-hidden="true" className="size-3.5" />Copy agent address</button></div>}
      </SectionCard>}
      <details className="mt-6 border border-white/15"><summary className="flex min-h-11 cursor-pointer items-center gap-2 px-5 py-3 text-sm"><Settings2 aria-hidden="true" className="size-4 text-white/55" />Settings</summary><div className="space-y-4 p-5 pt-2 text-sm">
        <button className={buttonClass.ghost} disabled={disabled || !status?.mandate} onClick={() => void act(async signal => { await post("pause", {}, signal); await load(signal); setMessage("Paused. Already submitted transactions can still settle."); })}><Pause aria-hidden="true" className="size-3.5" />Pause autopilot</button>
        <div className="flex flex-wrap items-center justify-between gap-3 border border-white/12 p-4">
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 font-medium"><Sparkles aria-hidden="true" className="size-4 text-[#9ec5f4]" />AI advisor<Tip label="About the AI advisor">Every six hours, when your policy changes and when a bill comes due, your agent runs. With the advisor on, a Groq model may invest less, wait, or move part of the Morpho position back to the agent&apos;s cash, always inside the limits Hodd&apos;s engine sets, and writes down why. It never sees addresses or bill names, and safety moves (protecting your bills, refilling the reserve, returning everything) are never up to it.</Tip></p>
            <p className="mt-1 text-[12px] text-white/55">{status?.advisor?.available ? (status.mandate?.advisorEnabled ? "On" : "Off") + (status.advisor.model ? `, ${status.advisor.model} on Groq` : "") : "Not enabled by the operator yet"}</p>
          </div>
          <button type="button" role="switch" aria-checked={Boolean(status?.mandate?.advisorEnabled)} aria-label="AI advisor" className={buttonClass.ghost} disabled={disabled || !status?.mandate || !status?.advisor?.available} onClick={() => void act(async signal => { await post("advisor", { enabled: !status?.mandate?.advisorEnabled }, signal); await load(signal); setMessage(status?.mandate?.advisorEnabled ? "AI advisor turned off. The engine decides alone." : "AI advisor turned on. It works inside the engine's limits."); })}>{status?.mandate?.advisorEnabled ? "Turn off" : "Turn on"}</button>
        </div>
        {status?.wallet && <><p className="break-all font-mono text-[13px]">{status.wallet.address}</p><a className="inline-flex min-h-11 items-center gap-1.5 text-[#9ec5f4] underline underline-offset-4" href={"https://testnet.arcscan.app/address/" + status.wallet.address} target="_blank" rel="noreferrer">View agent on ArcScan<ExternalLink aria-hidden="true" className="size-3.5" /></a></>}
      </div></details>
      <details className="mt-6 border border-white/15"><summary className="flex min-h-11 cursor-pointer items-center gap-2 px-5 py-3 text-sm"><History aria-hidden="true" className="size-4 text-white/55" />History{status && status.runs.length > 0 && <span className="mono text-[12px] tabular-nums text-white/50">{status.runs.length}</span>}</summary>
        {status?.runs.length ? <RunTimeline runs={status.runs} steps={status.steps} /> : <p className="p-5 pt-2 text-sm text-white/60">No runs yet. Invest to start your agent.</p>}
      </details>
      {unknownStep && <SectionCard className="mt-6"><SectionHeading icon={<LifeBuoy aria-hidden="true" className="size-4" />} title="Recover an uncertain submission" action={<Tip align="end" label="About recovery">Paste the hash for the displayed step. Exact sender, calldata and receipt must match; no funds are resent.</Tip>} /><form className="space-y-3 p-5" onSubmit={e=>{e.preventDefault();void act(async signal => { await post("recover", {stepId:unknownStep.id,txHash:candidate}, signal); await load(signal); });}}><p className="break-all text-xs text-white/60">Step {unknownStep.id}</p><label className="block text-xs">Transaction hash<input className={inputClass} value={candidate} onChange={e=>setCandidate(e.target.value)} pattern="0x[0-9a-fA-F]{64}" required/></label><button className={buttonClass.ghost} disabled={busy || !signedIn || !status?.executionEnabled}>Verify transaction</button></form></SectionCard>}
    </PageBody>
  </>;
}
